from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import plotly.graph_objects as go
import streamlit as st
import trimesh


CMS_DIR = Path(__file__).resolve().parent
REPO_ROOT = CMS_DIR.parent
PUBLIC_DIR = REPO_ROOT / "public"
MODELS_DIR = PUBLIC_DIR / "models"
OBJECTS_DIR = PUBLIC_DIR / "objects"
INDEX_PATH = OBJECTS_DIR / "_index.txt"


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


def write_index_entries(entries: list[str]) -> None:
    INDEX_PATH.write_text(
        "".join(f"{entry}\n" for entry in dedupe_preserving_order(entries)),
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


def parse_relationships_input(raw_text: str) -> dict[str, list[str]]:
    if not raw_text.strip():
        return {}

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ValueError(f"Relationships JSON is invalid: {error.msg}") from error

    return validate_relationships(parsed, path=Path("relationships.json"))


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


def format_relationships(relationships: dict[str, list[str]]) -> str:
    if not relationships:
        return "{}"

    return json.dumps(relationships, indent=4, ensure_ascii=True)


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


def initialize_editor_state(editor_key: str, slug: str, relationships: dict[str, list[str]]) -> None:
    if st.session_state.get("editor_key") == editor_key:
        return

    st.session_state.editor_key = editor_key
    st.session_state.slug_input = slug
    st.session_state.relationships_input = format_relationships(relationships)


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
        current_record.relationships if current_record else {},
    )

    form_column, preview_column = st.columns([1.05, 0.95], gap="large")

    with form_column:
        st.subheader("Assignment")
        st.code(f"/models/{selected_model}", language="text")

        if current_slug:
            st.info(f"Editing `{current_slug}`.")
        else:
            st.info("This model is currently unassigned.")

        with st.form("object-editor"):
            st.text_input("Object slug", key="slug_input", help="Used for both `_index.txt` and `public/objects/<slug>.json`.")
            st.text_area(
                "Relationships JSON",
                key="relationships_input",
                height=260,
                help='Optional object mapping, for example: {"apple": ["cut", "RETURN", "DESTRUCT"]}',
            )

            save_clicked = st.form_submit_button("Save Object", use_container_width=True)

        proposed_slug = slugify(st.session_state.slug_input)

        if proposed_slug and proposed_slug != st.session_state.slug_input:
            st.caption(f"Slug will be normalized to `{proposed_slug}` on save.")

        if save_clicked:
            if not proposed_slug:
                st.error("Object slug cannot be empty after normalization.")
            elif proposed_slug in state.records_by_slug and proposed_slug != current_slug:
                st.error(f"`{proposed_slug}` already exists. Rename or edit that object instead.")
            else:
                try:
                    relationships = parse_relationships_input(st.session_state.relationships_input)
                except ValueError as error:
                    st.error(str(error))
                else:
                    save_object_record(
                        current_slug=current_slug,
                        new_slug=proposed_slug,
                        model=selected_model,
                        relationships=relationships,
                    )
                    st.success(f"Saved `{proposed_slug}`.")
                    st.rerun()

        delete_disabled = current_slug is None

        if st.button("Delete Object", type="secondary", disabled=delete_disabled, use_container_width=True):
            delete_object_record(current_slug)
            st.success(f"Deleted `{current_slug}`.")
            st.rerun()

        with st.expander("Generated JSON", expanded=False):
            relationships_preview = {}

            try:
                relationships_preview = parse_relationships_input(st.session_state.relationships_input)
            except ValueError:
                pass

            preview_slug = proposed_slug or suggested_slug_for_model(selected_model)
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
