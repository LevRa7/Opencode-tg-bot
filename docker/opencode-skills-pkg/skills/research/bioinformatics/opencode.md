# Bioinformatics — Genomics, Transcriptomics, Variant Calling

Gateway to 400+ bioinformatics skills from bioSkills (385 reference skills) and
ClawBio (33 runnable pipeline skills).

## Prerequisites

```bash
apt install -y samtools bcftools ncbi-blast+ minimap2 bedtools fastp
pip install biopython pysam cyvcf2 pybedtools pyBigWig scikit-allel anndata scanpy mygene
```

## Setup

```bash
git clone --depth 1 https://github.com/GPTomics/bioSkills.git
git clone --depth 1 https://github.com/ClawBio/ClawBio.git
```

## Domains covered

Sequence Fundamentals, Read QC & Alignment, Variant Calling, Differential Expression,
Single-Cell (ScanPy, Seurat), Spatial Transcriptomics, Epigenomics, Pharmacogenomics,
Population Genetics, Metagenomics, Genome Assembly, Structural Biology, Proteomics,
Pathway Analysis, Immunoinformatics, CRISPR, ML for Omics.

## Usage

For any bioinformatics task, search the cloned repos for relevant scripts/instructions,
then execute via Bash with the appropriate tools.
