# CLIP — Contrastive Language-Image Pre-Training

OpenAI's model connecting vision and language. Zero-shot image classification, image-text matching, cross-modal retrieval.

## When to Use

- Zero-shot image classification (no training data needed)
- Image-text similarity/matching
- Semantic image search
- Content moderation (NSFW, violence detection)
- Cross-modal retrieval

## Installation

```bash
pip install git+https://github.com/openai/CLIP.git
pip install torch torchvision ftfy regex tqdm
```

## Zero-Shot Classification

```python
import torch
import clip
from PIL import Image

device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

image = preprocess(Image.open("photo.jpg")).unsqueeze(0).to(device)
text = clip.tokenize(["a dog", "a cat", "a bird", "a car"]).to(device)

with torch.no_grad():
    logits_per_image, _ = model(image, text)
    probs = logits_per_image.softmax(dim=-1).cpu().numpy()
```

## Available Models

| Model | Params | Quality |
|-------|--------|---------|
| RN50 | 102M | Good |
| ViT-B/32 | 151M | Better (recommended) |
| ViT-L/14 | 428M | Best |

## Semantic Image Search

```python
# Encode all images, normalize, then compare with text embedding
image_features /= image_features.norm(dim=-1, keepdim=True)
text_embedding /= text_embedding.norm(dim=-1, keepdim=True)
similarities = text_embedding @ image_features.T
top_k = similarities.topk(3)
```

## Content Moderation

```python
categories = ["safe for work", "not safe for work", "violent content", "graphic content"]
logits_per_image, _ = model(image, clip.tokenize(categories).to(device))
probs = logits_per_image.softmax(dim=-1)
```

## Best Practices

1. Use ViT-B/32 for most cases (good balance)
2. Normalize embeddings before cosine similarity
3. Batch processing for efficiency
4. Cache embeddings (expensive to recompute)
5. Use descriptive labels for better zero-shot performance
6. GPU recommended (10-50x faster)

## Limitations

- Best for broad categories, not fine-grained tasks
- Vague labels perform poorly
- May have web dataset biases
- No bounding boxes (whole image only)
- Limited spatial understanding (position/counting weak)
