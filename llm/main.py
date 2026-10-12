from unsloth import FastLanguageModel, is_bfloat16_supported
import torch
import os
from datasets import load_dataset
from unsloth.chat_templates import get_chat_template, train_on_responses_only
from trl import SFTTrainer
from transformers import TrainingArguments, DataCollatorForSeq2Seq, GenerationConfig
import numpy as np
import json
from rouge_score import rouge_scorer
import nltk
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
import pandas as pd
import matplotlib.pyplot as plt
from tqdm import tqdm
import random


# Set environment variables and constants
# Read from the environment; never hardcode Hub tokens
HF_TOKEN = os.environ["HF_TOKEN"]
MODEL_NAME = "meta-llama/Llama-3.2-3B-Instruct"
OUTPUT_MODEL_NAME = "jCool10/chat_anything-3B"
DATASET_PATH = "/workspace/dataset/*.json"

# Model configuration
max_seq_length = 2048
dtype = None  # Auto detection
load_in_4bit = True
load_in_8bit = False
full_finetuning = False
max_shard_size = "500MB"  # Size limit for each model shard file

# Load model and tokenizer
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=max_seq_length,
    dtype=dtype,
    load_in_4bit=load_in_4bit,
    token=HF_TOKEN
)

# Configure LoRA fine-tuning
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["k_proj", "v_proj", "q_proj", 
                    "o_proj", "gate_proj", "down_proj", 
                    "up_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
    use_rslora=False,
    init_lora_weights="loftq",
    loftq_config={"q_bit": 4},
)

# Set chat template
tokenizer = get_chat_template(
    tokenizer,
    chat_template="llama-3.2",
)

# Load and prepare dataset
dataset = load_dataset("json", data_files=DATASET_PATH)


# Create train/test split if not already present
def create_train_test_split(dataset, test_size=0.1, seed=3407):
    """
    Create train and test splits if not already present in the dataset.

    Args:
        dataset: The original dataset
        test_size: Proportion of data to use for testing (0-1)
        seed: Random seed for reproducibility

    Returns:
        Dictionary with 'train' and 'test' splits
    """
    if "test" in dataset.keys() and "train" in dataset.keys():
        print("Using existing train/test split")
        return dataset

    # If we only have a single split (e.g., 'train'), create a test split
    if len(dataset.keys()) == 1:
        split_name = list(dataset.keys())[0]
        full_dataset = dataset[split_name]

        # Shuffle and split dataset
        full_dataset = full_dataset.shuffle(seed=seed)
        dataset_size = len(full_dataset)
        test_size_int = max(
            int(dataset_size * test_size), 1
        )  # Ensure at least 1 test example

        # Create the splits
        test_dataset = full_dataset.select(range(test_size_int))
        train_dataset = full_dataset.select(range(test_size_int, dataset_size))

        print(f"Created train split with {len(train_dataset)} examples")
        print(f"Created test split with {len(test_dataset)} examples")

        return {"train": train_dataset, "test": test_dataset}

    # If we have multiple splits but not the expected ones
    print("Warning: Dataset has unexpected splits:", list(dataset.keys()))
    print("Using the first split for both training and evaluation")
    split_name = list(dataset.keys())[0]
    return {
        "train": dataset[split_name],
        "test": dataset[split_name].select(range(min(100, len(dataset[split_name])))),
    }


# Apply the train/test split
dataset_splits = create_train_test_split(dataset)


def formatting_dataset(examples):
    formatted_data = [
        {"role": "system", "content": examples["system_prompt"]},
        {"role": "user", "content": examples["question_text"]},
        {"role": "assistant", "content": examples["orig_answer_texts"]},
    ]
    return {"formatted_texts": formatted_data}


def formatting_prompts_func(examples):
    convos = examples["formatted_texts"]
    texts = [
        tokenizer.apply_chat_template(
            convo, tokenize=False, add_generation_prompt=False
        )
        for convo in convos
    ]
    return {"text": texts}


model.train()

# Process dataset for training
dataset_formatting = dataset_splits["train"].map(formatting_dataset, batched=False)
dataset_formatting = dataset_formatting.map(formatting_prompts_func, batched=True)

# Configure trainer
training_args = TrainingArguments(
    per_device_train_batch_size=2,
    gradient_accumulation_steps=64,
    warmup_steps=50,
    num_train_epochs=2,
    learning_rate=1e-5,
    fp16=not is_bfloat16_supported(),
    bf16=is_bfloat16_supported(),
    logging_steps=10,
    optim="paged_lion_8bit",
    weight_decay=0.01,
    lr_scheduler_type="cosine",
    seed=3407,
    output_dir="outputs",
    report_to="wandb",
    run_name="chat_anything-3B",
    save_strategy="steps",
    save_steps=50,
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset_formatting,
    dataset_text_field="text",
    max_seq_length=max_seq_length,
    data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer),
    dataset_num_proc=2,
    packing=True,
    args=training_args,
)

# Configure to train on responses only
trainer = train_on_responses_only(
    trainer,
    instruction_part="<|start_header_id|>user<|end_header_id|>\n\n",
    response_part="<|start_header_id|>assistant<|end_header_id|>\n\n",
)

# Display memory stats
gpu_stats = torch.cuda.get_device_properties(0)
start_gpu_memory = round(torch.cuda.max_memory_reserved() / 1024 / 1024 / 1024, 3)
max_memory = round(gpu_stats.total_memory / 1024 / 1024 / 1024, 3)
print(f"GPU = {gpu_stats.name}. Max memory = {max_memory} GB.")
print(f"{start_gpu_memory} GB of memory reserved.")

# Train the model
trainer_stats = trainer.train()

# Save and upload model with sharding
model.save_pretrained("chat_anything-3B", max_shard_size=max_shard_size)
tokenizer.save_pretrained("chat_anything-3B")

merged_model = model.merge_and_unload()
merged_model.save_pretrained("chat_anything-3B-merged", max_shard_size=max_shard_size)
tokenizer.save_pretrained("chat_anything-3B-merged")

model.push_to_hub(OUTPUT_MODEL_NAME, token=HF_TOKEN, max_shard_size=max_shard_size)
tokenizer.push_to_hub(OUTPUT_MODEL_NAME, token=HF_TOKEN)

merged_model.push_to_hub(
    "jCool10/chat_anything-3B-merged", token=HF_TOKEN, max_shard_size=max_shard_size
)
tokenizer.push_to_hub("jCool10/chat_anything-3B-merged", token=HF_TOKEN)

# evaluate the model
print("\n=== Running comprehensive evaluation ===")


def download_nltk_resources():
    try:
        nltk.data.find("tokenizers/punkt")
    except LookupError:
        nltk.download("punkt_tab")


download_nltk_resources()


def evaluate_model(
    model, tokenizer, dataset, num_samples=50, output_dir="evaluation_results"
):
    """
    Comprehensive model evaluation with multiple metrics

    Args:
        model: The fine-tuned model
        tokenizer: The tokenizer
        dataset: Dataset to evaluate on - should be a test dataset
        num_samples: Maximum number of samples to evaluate
        output_dir: Directory to save evaluation results

    Returns:
        Dictionary of evaluation results
    """
    os.makedirs(output_dir, exist_ok=True)

    # Use the entire test dataset, or limit to num_samples
    eval_dataset = dataset.select(range(min(num_samples, len(dataset))))
    print(f"Evaluating on {len(eval_dataset)} examples")

    eval_formatted = eval_dataset.map(formatting_dataset, batched=False).map(
        formatting_prompts_func, batched=True
    )

    generation_config = GenerationConfig(
        max_new_tokens=512,
        temperature=0.5,
        top_p=0.95,
        repetition_penalty=1.2,
    )

    # Initialize metrics
    rouge_metrics = rouge_scorer.RougeScorer(
        ["rouge1", "rouge2", "rougeL"], use_stemmer=True
    )
    smooth = SmoothingFunction().method1

    results = []
    model.eval()

    for i, example in tqdm(enumerate(eval_formatted), total=len(eval_formatted)):
        # Extract ground truth answer from the example
        system_prompt = example["formatted_texts"][0]["content"]
        user_query = example["formatted_texts"][1]["content"]
        ground_truth = example["formatted_texts"][2]["content"]

        # Format input for the model
        input_text = tokenizer.apply_chat_template(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query},
            ],
            tokenize=False,
            add_generation_prompt=True,
        )

        # Generate response
        inputs = tokenizer(input_text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            outputs = model.generate(**inputs, generation_config=generation_config)

        generated_response = tokenizer.decode(outputs[0], skip_special_tokens=True)

        # Skip prefix (find the actual response part)
        response = generated_response.split(
            "<|start_header_id|>assistant<|end_header_id|>\n\n"
        )[-1].strip()

        # Calculate metrics
        rouge_scores = rouge_metrics.score(ground_truth, response)

        # Calculate BLEU score
        reference_tokens = nltk.word_tokenize(ground_truth.lower())
        hypothesis_tokens = nltk.word_tokenize(response.lower())
        bleu_score = sentence_bleu(
            [reference_tokens], hypothesis_tokens, smoothing_function=smooth
        )

        # Store result
        result = {
            "example_id": i,
            "system_prompt": system_prompt,
            "user_query": user_query,
            "ground_truth": ground_truth,
            "model_response": response,
            "rouge1_f1": rouge_scores["rouge1"].fmeasure,
            "rouge2_f1": rouge_scores["rouge2"].fmeasure,
            "rougeL_f1": rouge_scores["rougeL"].fmeasure,
            "bleu": bleu_score,
        }
        results.append(result)

        # Print sample of evaluations
        if i < 3:
            print(f"\nExample {i+1}:")
            print(f"User query: {user_query[:100]}...")
            print(f"Ground truth: {ground_truth[:100]}...")
            print(f"Generated: {response[:100]}...")
            print(
                f"ROUGE-1: {rouge_scores['rouge1'].fmeasure:.4f}, BLEU: {bleu_score:.4f}"
            )

    # Calculate average metrics
    avg_metrics = {
        "avg_rouge1": np.mean([r["rouge1_f1"] for r in results]),
        "avg_rouge2": np.mean([r["rouge2_f1"] for r in results]),
        "avg_rougeL": np.mean([r["rougeL_f1"] for r in results]),
        "avg_bleu": np.mean([r["bleu"] for r in results]),
    }

    # Save detailed results
    with open(f"{output_dir}/evaluation_results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Save summary metrics
    with open(f"{output_dir}/evaluation_summary.json", "w") as f:
        json.dump(avg_metrics, f, indent=2)

    # Create visualizations
    metrics_df = pd.DataFrame(
        [
            {
                "example_id": r["example_id"],
                "rouge1": r["rouge1_f1"],
                "rouge2": r["rouge2_f1"],
                "rougeL": r["rougeL_f1"],
                "bleu": r["bleu"],
            }
            for r in results
        ]
    )

    # Plot metrics distribution
    plt.figure(figsize=(12, 6))
    for metric in ["rouge1", "rouge2", "rougeL", "bleu"]:
        plt.hist(metrics_df[metric], alpha=0.5, bins=20, label=metric)
    plt.legend()
    plt.title("Distribution of Evaluation Metrics")
    plt.xlabel("Score")
    plt.ylabel("Frequency")
    plt.savefig(f"{output_dir}/metrics_distribution.png")

    # Print summary
    print("\n=== Evaluation Summary ===")
    print(f"Number of examples evaluated: {len(results)}")
    print(f"Average ROUGE-1: {avg_metrics['avg_rouge1']:.4f}")
    print(f"Average ROUGE-2: {avg_metrics['avg_rouge2']:.4f}")
    print(f"Average ROUGE-L: {avg_metrics['avg_rougeL']:.4f}")
    print(f"Average BLEU: {avg_metrics['avg_bleu']:.4f}")
    print(f"Detailed results saved to {output_dir}/")

    return avg_metrics


# Run evaluation using the test split
eval_metrics = evaluate_model(
    model=merged_model,  # Using the merged model for evaluation
    tokenizer=tokenizer,
    dataset=dataset_splits["test"],
    num_samples=50,  # Evaluate on 50 samples, adjust as needed
    output_dir="evaluation_results",
)

print("\n=== Process complete ===")

# Dependencies comment for reference
# pip install bitsandbytes peft trl datasets hf_transfer unsloth scipy wandb rouge_score nltk pandas matplotlib
