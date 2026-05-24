# TPR Object CMS

Streamlit UI for maintaining `public/objects/_index.txt` and `public/objects/*.json` against the GLB files in `public/models/`.

## What it does

- Browses every `.glb` under `public/models/`
- Shows which models already have an object slug assigned
- Writes `public/objects/<slug>.json` with the existing runtime schema
- Keeps `_index.txt` in sync when creating, renaming, or deleting objects
- Flags index / JSON / model mismatches and can rebuild the index from valid JSON files
- Renders a local mesh preview for the selected GLB

## Run

From the repo root:

```bash
uv run --project cms streamlit run cms/app.py
```

Or from inside `cms/`:

```bash
uv run streamlit run app.py
```

## Schema rules preserved

- `_index.txt` stays newline-delimited, one slug per line
- Object JSON supports the current runtime relationship shape plus an optional object-level `hold` block:

```json
{
    "model": "k-food/apple.glb",
    "hold": {
        "anchor": [0.0, 0.8, 0.0],
        "scale": 0.35
    },
    "relationships": {
        "banana": ["cut", "RETURN", "DESTRUCT"]
    }
}
```

- `relationships` is omitted when empty
- `hold` is omitted when the object has no hold placement defined
