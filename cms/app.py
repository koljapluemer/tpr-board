from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import plotly.graph_objects as go
import pandas as pd
import streamlit as st
import trimesh


CMS_DIR = Path(__file__).resolve().parent
REPO_ROOT = CMS_DIR.parent
PUBLIC_DIR = REPO_ROOT / "public"
MODELS_DIR = PUBLIC_DIR / "models"
OBJECTS_DIR = PUBLIC_DIR / "objects"
INDEX_PATH = OBJECTS_DIR / "_index.txt"
TPR_BOARD_DATA_DIR = PUBLIC_DIR / "tpr-board-data"
TPR_BOARD_DATA_INDEX_PATH = TPR_BOARD_DATA_DIR / "index.txt"
EFFECT_OPTIONS = ("NOTHING", "RETURN", "DISAPPEAR", "DESTRUCT", "WIGGLE", "HOLD")
RELATIONSHIP_COLUMNS = ["Target", "Verb", "Effect on A", "Effect on B"]


@dataclass(frozen=True)
class ObjectRecord:
    slug: str
    model: str
    relationships: dict[str, list[str]]


@dataclass(frozen=True)
class RepositoryState:
    models: list[str]
    index_entries: list[str]
    duplicate_index_entries: list[str]
    records_by_slug: dict[str, ObjectRecord]
    invalid_record_errors: dict[str, str]
    missing_index_files: list[str]
    unindexed_records: list[str]
    model_to_slugs: dict[str, list[str]]
    missing_model_files: list[str]
    unassigned_models: list[str]


def normalize_path(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def dedupe_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []

    for value in values:
        if value in seen:
            continue

        seen.add(value)
        unique_values.append(value)

    return unique_values


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-")


def suggested_slug_for_model(model_path: str) -> str:
    return slugify(Path(model_path).stem.replace("_", "-"))


def read_index_entries() -> list[str]:
    if not INDEX_PATH.exists():
        return []

    return [
        line.strip()
        for line in INDEX_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def read_active_language_codes() -> list[str]:
    if not TPR_BOARD_DATA_INDEX_PATH.exists():
        return []

    return [
        line.strip()
        for line in TPR_BOARD_DATA_INDEX_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_index_entries(entries: list[str]) -> None:
    INDEX_PATH.write_text(
        "".join(f"{entry}\n" for entry in dedupe_preserving_order(entries)),
        encoding="utf-8",
    )


def relationship_task_key(source_slug: str, verb: str, target_slug: str) -> str:
    return f"{source_slug}_{verb}_{target_slug}"


def load_locale_task_map(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {}

    raw_text = path.read_text(encoding="utf-8").strip()

    if not raw_text:
        return {}

    data = json.loads(raw_text)

    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: root JSON value must be an object")

    normalized: dict[str, list[str]] = {}

    for key, value in data.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError(f"{path.name}: task keys must be non-empty strings")

        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError(f"{path.name}: values for '{key}' must be arrays of strings")

        normalized[key] = value

    return normalized


def serialize_locale_task_map(locale_task_map: dict[str, list[str]]) -> str:
    return json.dumps(locale_task_map, indent=4, ensure_ascii=True) + "\n"


def seed_relationship_task_keys(
    *,
    source_slug: str,
    relationships: dict[str, list[str]],
) -> None:
    task_keys = [
        relationship_task_key(source_slug, actions[0].strip(), target_slug)
        for target_slug, actions in sorted(relationships.items())
        if actions and actions[0].strip()
    ]

    if not task_keys:
        return

    for language_code in read_active_language_codes():
        locale_path = TPR_BOARD_DATA_DIR / language_code / f"{language_code}.json"
        locale_path.parent.mkdir(parents=True, exist_ok=True)

        locale_task_map = load_locale_task_map(locale_path)
        changed = False

        for task_key in task_keys:
            if task_key in locale_task_map:
                continue

            locale_task_map[task_key] = []
            changed = True

        if changed:
            locale_path.write_text(
                serialize_locale_task_map(locale_task_map),
                encoding="utf-8",
            )


def validate_relationships(value: Any, *, path: Path) -> dict[str, list[str]]:
    if value is None:
        return {}

    if not isinstance(value, dict):
        raise ValueError(f"{path.name}: relationships must be an object")

    normalized: dict[str, list[str]] = {}

    for target, actions in value.items():
        if not isinstance(target, str) or not target.strip():
            raise ValueError(f"{path.name}: relationships keys must be non-empty strings")

        if not isinstance(actions, list) or any(not isinstance(action, str) for action in actions):
            raise ValueError(f"{path.name}: relationships for '{target}' must be a list of strings")

        if actions:
            normalized[target] = actions

    return normalized


def load_object_record(path: Path) -> ObjectRecord:
    data = json.loads(path.read_text(encoding="utf-8"))

    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: root JSON value must be an object")

    model = data.get("model")

    if not isinstance(model, str) or not model.strip():
        raise ValueError(f"{path.name}: model must be a non-empty string")

    relationships = validate_relationships(data.get("relationships"), path=path)

    return ObjectRecord(slug=path.stem, model=model, relationships=relationships)


def discover_models() -> list[str]:
    if not MODELS_DIR.exists():
        return []

    return sorted(normalize_path(path, MODELS_DIR) for path in MODELS_DIR.rglob("*.glb"))


def load_repository_state() -> RepositoryState:
    models = discover_models()
    model_set = set(models)

    index_entries = read_index_entries()
    duplicate_index_entries = sorted(
        slug for slug, count in Counter(index_entries).items() if count > 1
    )

    records_by_slug: dict[str, ObjectRecord] = {}
    invalid_record_errors: dict[str, str] = {}

    if OBJECTS_DIR.exists():
        for path in sorted(OBJECTS_DIR.glob("*.json")):
            if path.name == "_index.txt":
                continue

            try:
                record = load_object_record(path)
            except (OSError, json.JSONDecodeError, ValueError) as error:
                invalid_record_errors[path.stem] = str(error)
                continue

            records_by_slug[record.slug] = record

    missing_index_files = [slug for slug in index_entries if slug not in records_by_slug]
    unindexed_records = sorted(slug for slug in records_by_slug if slug not in index_entries)

    model_to_slugs: dict[str, list[str]] = {}
    missing_model_files: list[str] = []

    for slug, record in sorted(records_by_slug.items()):
        model_to_slugs.setdefault(record.model, []).append(slug)

        if record.model not in model_set:
            missing_model_files.append(slug)

    assigned_models = set(model_to_slugs)
    unassigned_models = [model for model in models if model not in assigned_models]

    return RepositoryState(
        models=models,
        index_entries=index_entries,
        duplicate_index_entries=duplicate_index_entries,
        records_by_slug=records_by_slug,
        invalid_record_errors=invalid_record_errors,
        missing_index_files=missing_index_files,
        unindexed_records=unindexed_records,
        model_to_slugs=model_to_slugs,
        missing_model_files=sorted(missing_model_files),
        unassigned_models=unassigned_models,
    )


def serialize_object_payload(model: str, relationships: dict[str, list[str]]) -> str:
    payload: dict[str, Any] = {"model": model}

    if relationships:
        payload["relationships"] = relationships

    return json.dumps(payload, indent=4, ensure_ascii=True) + "\n"


def save_object_record(
    *,
    current_slug: str | None,
    new_slug: str,
    model: str,
    relationships: dict[str, list[str]],
) -> None:
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

    target_path = OBJECTS_DIR / f"{new_slug}.json"
    previous_path = OBJECTS_DIR / f"{current_slug}.json" if current_slug else None

    target_path.write_text(
        serialize_object_payload(model, relationships),
        encoding="utf-8",
    )

    seed_relationship_task_keys(source_slug=new_slug, relationships=relationships)

    if previous_path and previous_path != target_path and previous_path.exists():
        previous_path.unlink()

    index_entries = read_index_entries()
    insertion_index = len(index_entries)

    if current_slug and current_slug in index_entries:
        insertion_index = index_entries.index(current_slug)
    elif new_slug in index_entries:
        insertion_index = index_entries.index(new_slug)

    filtered_entries = [
        entry for entry in index_entries if entry not in {current_slug, new_slug}
    ]
    filtered_entries.insert(min(insertion_index, len(filtered_entries)), new_slug)
    write_index_entries(filtered_entries)


def delete_object_record(slug: str) -> None:
    target_path = OBJECTS_DIR / f"{slug}.json"

    if target_path.exists():
        target_path.unlink()

    write_index_entries([entry for entry in read_index_entries() if entry != slug])


def rebuild_index(state: RepositoryState) -> None:
    ordered_entries = [slug for slug in dedupe_preserving_order(state.index_entries) if slug in state.records_by_slug]
    missing_entries = sorted(slug for slug in state.records_by_slug if slug not in ordered_entries)
    write_index_entries(ordered_entries + missing_entries)


def normalize_cell_value(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, float) and math.isnan(value):
        return ""

    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def normalize_effect(value: Any) -> str:
    effect = normalize_cell_value(value)
    return effect if effect in EFFECT_OPTIONS else EFFECT_OPTIONS[0]


def relationships_to_dataframe(relationships: dict[str, list[str]]) -> pd.DataFrame:
    rows: list[dict[str, str]] = []

    for target, actions in sorted(relationships.items()):
        rows.append(
            {
                "Target": target,
                "Verb": actions[0] if len(actions) > 0 else "",
                "Effect on A": normalize_effect(actions[1] if len(actions) > 1 else None),
                "Effect on B": normalize_effect(actions[2] if len(actions) > 2 else None),
            }
        )

    return pd.DataFrame(rows, columns=RELATIONSHIP_COLUMNS)


def collect_known_verbs(state: RepositoryState) -> list[str]:
    verbs = {
        actions[0].strip()
        for record in state.records_by_slug.values()
        for actions in record.relationships.values()
        if actions and actions[0].strip()
    }
    return sorted(verbs)


def parse_relationship_editor_rows(
    rows: pd.DataFrame,
    *,
    current_slug: str | None,
    valid_targets: set[str],
) -> tuple[dict[str, list[str]], list[str]]:
    relationships: dict[str, list[str]] = {}
    errors: list[str] = []
    seen_targets: set[str] = set()

    for row_number, row in enumerate(rows.to_dict("records"), start=1):
        target = normalize_cell_value(row.get("Target"))
        verb = normalize_cell_value(row.get("Verb"))
        effect_on_a = normalize_effect(row.get("Effect on A"))
        effect_on_b = normalize_effect(row.get("Effect on B"))

        if not target and not verb:
            continue

        if not target:
            errors.append(f"Row {row_number}: target is required.")
            continue

        if not verb:
            errors.append(f"Row {row_number}: verb is required for `{target}`.")
            continue

        if current_slug and target == current_slug:
            errors.append(f"Row {row_number}: `{target}` cannot target itself.")
            continue

        if target not in valid_targets:
            errors.append(f"Row {row_number}: `{target}` is not a known object slug.")
            continue

        if target in seen_targets:
            errors.append(f"Row {row_number}: `{target}` is duplicated. Use at most one row per target.")
            continue

        seen_targets.add(target)
        relationships[target] = [verb, effect_on_a, effect_on_b]

    return relationships, errors


def collect_inbound_relationships(state: RepositoryState, target_slug: str | None) -> pd.DataFrame:
    if not target_slug:
        return pd.DataFrame(columns=["Source", "Verb", "Effect on Source", "Effect on Target"])

    rows: list[dict[str, str]] = []

    for source_slug, record in sorted(state.records_by_slug.items()):
        actions = record.relationships.get(target_slug)

        if not actions:
            continue

        rows.append(
            {
                "Source": source_slug,
                "Verb": actions[0] if len(actions) > 0 else "",
                "Effect on Source": normalize_effect(actions[1] if len(actions) > 1 else None),
                "Effect on Target": normalize_effect(actions[2] if len(actions) > 2 else None),
            }
        )

    return pd.DataFrame(rows)


@st.cache_data(show_spinner=False)
def build_model_preview_figure(model_path: str) -> go.Figure:
    full_model_path = MODELS_DIR / model_path
    loaded = trimesh.load(full_model_path, force="scene")

    meshes: list[trimesh.Trimesh] = []

    if isinstance(loaded, trimesh.Trimesh):
        meshes.append(loaded)
    else:
        for node_name in loaded.graph.nodes_geometry:
            transform, geometry_name = loaded.graph[node_name]
            geometry = loaded.geometry.get(geometry_name)

            if not isinstance(geometry, trimesh.Trimesh):
                continue

            transformed = geometry.copy()
            transformed.apply_transform(transform)
            meshes.append(transformed)

    if not meshes:
        raise ValueError("No mesh geometry found in model")

    merged_mesh = trimesh.util.concatenate(meshes)
    vertices = merged_mesh.vertices
    faces = merged_mesh.faces

    figure = go.Figure(
        data=[
            go.Mesh3d(
                x=vertices[:, 0],
                y=vertices[:, 2],
                z=vertices[:, 1],
                i=faces[:, 0],
                j=faces[:, 1],
                k=faces[:, 2],
                color="#d66b47",
                flatshading=True,
                hoverinfo="skip",
                lighting={
                    "ambient": 0.65,
                    "diffuse": 0.85,
                    "fresnel": 0.1,
                    "roughness": 0.9,
                    "specular": 0.15,
                },
                lightposition={"x": 120, "y": 80, "z": 160},
            )
        ]
    )

    figure.update_layout(
        margin={"l": 0, "r": 0, "t": 0, "b": 0},
        paper_bgcolor="#f7f1e5",
        scene={
            "aspectmode": "data",
            "bgcolor": "#f7f1e5",
            "camera": {
                "eye": {"x": 1.45, "y": 1.3, "z": 0.9},
                "up": {"x": 0, "y": 0, "z": 1},
            },
            "xaxis": {"visible": False},
            "yaxis": {"visible": False},
            "zaxis": {"visible": False},
        },
    )

    return figure


def assignment_label(state: RepositoryState, model: str) -> str:
    slugs = state.model_to_slugs.get(model, [])

    if not slugs:
        return f"{model}  [unassigned]"

    if len(slugs) == 1:
        return f"{model}  ->  {slugs[0]}"

    return f"{model}  ->  {', '.join(slugs)}"


def unassigned_model_label(model: str) -> str:
    return f"{model}  ->  {suggested_slug_for_model(model)}"


def visible_models(state: RepositoryState, search_term: str, show_unassigned_only: bool) -> list[str]:
    filtered = state.unassigned_models if show_unassigned_only else state.models

    if not search_term:
        return filtered

    search = search_term.strip().lower()
    visible: list[str] = []

    for model in filtered:
        haystack = " ".join([model, *state.model_to_slugs.get(model, [])]).lower()

        if search in haystack:
            visible.append(model)

    return visible


def initialize_editor_state(editor_key: str, slug: str) -> None:
    if st.session_state.get("editor_key") == editor_key:
        return

    st.session_state.editor_key = editor_key
    st.session_state.slug_input = slug


def jump_to_unassigned_model() -> None:
    selected_model = st.session_state.get("unassigned_model_jump")

    if selected_model:
        st.session_state.selected_model = selected_model


def render_health_panel(state: RepositoryState) -> None:
    issues = (
        len(state.duplicate_index_entries)
        + len(state.missing_index_files)
        + len(state.unindexed_records)
        + len(state.invalid_record_errors)
        + len(state.missing_model_files)
    )

    st.subheader("Repository Health")
    st.metric("Open issues", issues)

    if issues == 0:
        st.success("Index, object JSON, and model references are in sync.")
        return

    if state.duplicate_index_entries:
        st.warning(f"Duplicate index entries: {', '.join(state.duplicate_index_entries)}")

    if state.missing_index_files:
        st.error(f"Indexed without JSON file: {', '.join(state.missing_index_files)}")

    if state.unindexed_records:
        st.warning(f"JSON file missing from index: {', '.join(state.unindexed_records)}")

    if state.invalid_record_errors:
        for slug, error in state.invalid_record_errors.items():
            st.error(f"{slug}.json is invalid: {error}")

    if state.missing_model_files:
        st.error(f"Object JSON points at a missing model: {', '.join(state.missing_model_files)}")

    if st.button("Repair Index", use_container_width=True):
        rebuild_index(state)
        st.success("Rebuilt _index.txt from valid object JSON files.")
        st.rerun()


def main() -> None:
    st.set_page_config(
        page_title="TPR Object CMS",
        page_icon="🧩",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    st.markdown(
        """
        <style>
        :root {
            color-scheme: light;
        }
        .stApp,
        [data-testid="stAppViewContainer"],
        [data-testid="stHeader"],
        [data-testid="stToolbar"] {
            background: #f6efe1;
            color: #20170f;
        }
        .stApp {
            background:
                radial-gradient(circle at top left, #fff9ef 0%, #fff9ef 18%, transparent 45%),
                linear-gradient(180deg, #f6efe1 0%, #efe4d3 100%);
        }
        [data-testid="stHeader"] {
            background: rgba(246, 239, 225, 0.88);
        }
        [data-testid="stSidebar"] *,
        .stApp * {
            color: #20170f;
        }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #f0e2cb 0%, #ebdcc4 100%);
        }
        [data-testid="stSidebar"] > div:first-child {
            background: linear-gradient(180deg, #f0e2cb 0%, #ebdcc4 100%);
        }
        [data-baseweb="input"],
        [data-baseweb="select"],
        [data-baseweb="textarea"],
        .stCodeBlock,
        .stTextArea textarea,
        .stTextInput input,
        .stSelectbox div[data-baseweb="select"] > div,
        .stMultiSelect div[data-baseweb="select"] > div {
            background: rgba(255, 250, 242, 0.96) !important;
            color: #20170f !important;
            border-color: rgba(126, 86, 56, 0.24) !important;
        }
        .stButton > button,
        .stDownloadButton > button,
        .stFormSubmitButton > button {
            background: #fff7ec;
            color: #20170f;
            border: 1px solid rgba(126, 86, 56, 0.24);
        }
        .stButton > button[kind="primary"],
        .stFormSubmitButton > button[kind="primary"] {
            background: #d66b47;
            color: #fff8f0;
            border-color: #d66b47;
        }
        .stAlert,
        .stCode,
        [data-testid="stExpander"] {
            background: rgba(255, 250, 242, 0.9);
            color: #20170f;
        }
        div[data-testid="stMetric"] {
            background: rgba(255, 250, 240, 0.72);
            border: 1px solid rgba(126, 86, 56, 0.12);
            border-radius: 14px;
            padding: 0.5rem 0.8rem;
        }
        div[data-testid="stMetric"] * {
            color: #20170f !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    state = load_repository_state()

    st.title("TPR Object CMS")
    st.caption("Map GLB models to object slugs, preview meshes, and keep `public/objects` consistent.")

    top_left, top_mid, top_right, top_far = st.columns(4)
    top_left.metric("GLB models", len(state.models))
    top_mid.metric("Object JSON files", len(state.records_by_slug))
    top_right.metric("Indexed objects", len(dedupe_preserving_order(state.index_entries)))
    top_far.metric("Unassigned models", len(state.unassigned_models))

    with st.sidebar:
        st.header("Model Browser")
        search_term = st.text_input("Filter", placeholder="apple, character, k-food")
        show_unassigned_only = st.toggle("Only show unassigned models", value=False)
        model_options = visible_models(state, search_term, show_unassigned_only)

        st.caption(
            f"{len(state.unassigned_models)} model(s) do not have a matching "
            "`public/objects/<slug>.json` entry yet."
        )

        if state.unassigned_models:
            unassigned_options = visible_models(state, search_term, True)
            st.selectbox(
                "Unassigned models",
                options=[""] + unassigned_options,
                index=0,
                key="unassigned_model_jump",
                on_change=jump_to_unassigned_model,
                format_func=lambda model: "Pick an unassigned model..." if not model else unassigned_model_label(model),
                help="Quick way to jump straight to GLBs that are not represented in `_index.txt` and `public/objects/` yet.",
            )

        if not model_options:
            st.info("No models match the current filter.")
            render_health_panel(state)
            return

        selected_model = st.selectbox(
            "Model",
            options=model_options,
            key="selected_model",
            format_func=lambda model: assignment_label(state, model),
        )
        render_health_panel(state)

    assigned_slugs = state.model_to_slugs.get(selected_model, [])

    if len(assigned_slugs) > 1:
        st.warning(
            "This model is currently referenced by multiple object JSON files. "
            "Pick the one you want to edit."
        )
        current_slug = st.selectbox("Object record", assigned_slugs)
    else:
        current_slug = assigned_slugs[0] if assigned_slugs else None

    current_record = state.records_by_slug.get(current_slug) if current_slug else None
    editor_key = f"{selected_model}::{current_slug or '__new__'}"
    initialize_editor_state(
        editor_key,
        current_slug or suggested_slug_for_model(selected_model),
    )

    form_column, preview_column = st.columns([1.05, 0.95], gap="large")

    with form_column:
        st.subheader("Assignment")
        st.code(f"/models/{selected_model}", language="text")

        if current_slug:
            st.info(f"Editing `{current_slug}`.")
        else:
            st.info("This model is currently unassigned.")

        st.text_input(
            "Object slug",
            key="slug_input",
            help="Used for both `_index.txt` and `public/objects/<slug>.json`.",
        )
        st.subheader("Relationships")
        st.caption("One row per target object. Add or edit rows inline, then save once.")

        proposed_slug = slugify(st.session_state.slug_input)
        relationship_editor_key = f"relationship_editor::{editor_key}"
        valid_target_options = sorted(
            slug for slug in state.records_by_slug if slug != current_slug
        )
        relationship_rows = st.data_editor(
            relationships_to_dataframe(current_record.relationships if current_record else {}),
            key=relationship_editor_key,
            hide_index=True,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "Target": st.column_config.SelectboxColumn(
                    "Target",
                    options=valid_target_options,
                    help="Pick the other object slug affected by this relationship.",
                    required=False,
                    width="medium",
                ),
                "Verb": st.column_config.TextColumn(
                    "Verb",
                    help="Free-text action, for example `cut` or `get-into`.",
                    required=False,
                    width="small",
                ),
                "Effect on A": st.column_config.SelectboxColumn(
                    "Effect on A",
                    options=list(EFFECT_OPTIONS),
                    required=True,
                    width="small",
                ),
                "Effect on B": st.column_config.SelectboxColumn(
                    "Effect on B",
                    options=list(EFFECT_OPTIONS),
                    required=True,
                    width="small",
                ),
            },
        )

        if proposed_slug and proposed_slug != st.session_state.slug_input:
            st.caption(f"Slug will be normalized to `{proposed_slug}` on save.")

        known_verbs = collect_known_verbs(state)

        if known_verbs:
            st.caption(f"Known verbs: {', '.join(known_verbs[:12])}")

        relationships_preview, relationship_errors = parse_relationship_editor_rows(
            relationship_rows,
            current_slug=current_slug,
            valid_targets=set(valid_target_options),
        )

        if relationship_errors:
            for error in relationship_errors[:6]:
                st.warning(error)

            if len(relationship_errors) > 6:
                st.caption(f"{len(relationship_errors) - 6} more relationship issue(s) not shown.")

        save_clicked = st.button("Save Object", type="primary", use_container_width=True)

        if save_clicked:
            if not proposed_slug:
                st.error("Object slug cannot be empty after normalization.")
            elif proposed_slug in state.records_by_slug and proposed_slug != current_slug:
                st.error(f"`{proposed_slug}` already exists. Rename or edit that object instead.")
            elif relationship_errors:
                st.error("Fix the relationship rows before saving.")
            else:
                save_object_record(
                    current_slug=current_slug,
                    new_slug=proposed_slug,
                    model=selected_model,
                    relationships=relationships_preview,
                )
                st.success(f"Saved `{proposed_slug}`.")
                st.rerun()

        delete_disabled = current_slug is None

        if st.button("Delete Object", type="secondary", disabled=delete_disabled, use_container_width=True):
            delete_object_record(current_slug)
            st.success(f"Deleted `{current_slug}`.")
            st.rerun()

        inbound_rows = collect_inbound_relationships(state, current_slug)

        with st.expander("Inbound Relationships", expanded=False):
            if inbound_rows.empty:
                st.caption("No other object currently points at this object.")
            else:
                st.dataframe(inbound_rows, hide_index=True, use_container_width=True)

        with st.expander("Generated JSON", expanded=False):
            preview_slug = proposed_slug or suggested_slug_for_model(selected_model)

            if relationship_errors:
                st.caption("Preview updates after the relationship rows validate cleanly.")
            else:
                preview_json = serialize_object_payload(selected_model, relationships_preview)
                st.code(f"// public/objects/{preview_slug}.json\n{preview_json}", language="json")

    with preview_column:
        st.subheader("Preview")

        try:
            figure = build_model_preview_figure(selected_model)
        except Exception as error:  # noqa: BLE001
            st.warning(f"Preview unavailable: {error}")
        else:
            st.plotly_chart(figure, use_container_width=True, config={"displaylogo": False})

        model_path = MODELS_DIR / selected_model
        details = {
            "Folder": Path(selected_model).parent.as_posix(),
            "File": Path(selected_model).name,
            "Size": f"{model_path.stat().st_size / 1024:.1f} KB",
            "Assigned slug(s)": ", ".join(assigned_slugs) if assigned_slugs else "None",
        }
        st.json(details, expanded=True)


if __name__ == "__main__":
    main()
