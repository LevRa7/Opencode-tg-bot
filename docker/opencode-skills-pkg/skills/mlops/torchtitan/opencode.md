# TorchTitan — Distributed LLM Pretraining

PyTorch-native distributed LLM pretraining with 4D parallelism:
FSDP2 (Fully Sharded Data Parallel), TP (Tensor Parallel),
PP (Pipeline Parallel), CP (Context Parallel).

## Prerequisites

```bash
pip install torchtitan torch>=2.6.0 torchao>=0.5.0
export HF_TOKEN=<your-hf-token>  # for Llama tokenizer
```

## Quick start (8 GPUs)

```bash
torchrun --nproc_per_node=8 train.py --model llama3_1_8b --enable-fsdp
```

## When to use

- Pretraining Llama-scale models (8B → 405B)
- Fine-tuning at scale (8-512+ GPUs)
- Float8 training on H100s

## Workflows

1. **Single node** (8 GPUs): Llama 3.1 8B pretrain
2. **Multi-node** (SLURM, 256 GPUs): 70B model
3. **Float8** (H100): Mixed-precision with 30% less memory
4. **4D parallelism** (512+ GPUs): 405B models

## Reference

`torchtitan` GitHub: https://github.com/pytorch/torchtitan
