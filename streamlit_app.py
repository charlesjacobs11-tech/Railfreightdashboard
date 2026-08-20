import json
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Secondary Rail Freight Market Dashboard", layout="wide")

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"

# Every relative path the dashboard's app.js fetches at startup (see loadData() in app.js).
DATA_FILES = [
    "secondary_railcar_bids.json",
    "pnw_bulk_export_monthly.json",
    "rail_origin_dwell_monthly.json",
    "rail_terminal_dwell_monthly.json",
    "rail_train_speed_monthly.json",
    "weather_stations_monthly.json",
    "row_crop_production_annual.json",
]


@st.cache_resource
def build_html():
    # The dashboard is a fully self-contained static site (index.html + app.js + styles.css,
    # data/*.json loaded via fetch()). Streamlit Cloud only runs Python apps, so rather than
    # port six tabs of hand-rolled SVG charting and OLS regression to Python, this wrapper
    # inlines the existing site untouched into one HTML blob and renders it with
    # components.html(). The one real incompatibility: fetch('data/x.json') resolves against
    # the sandboxed iframe Streamlit renders it in, not this app's working directory — so
    # relative fetches are pre-empted with a shim that serves the JSON straight out of memory
    # instead of hitting the network. app.js itself needed zero changes.
    html = (ROOT / "index.html").read_text(encoding="utf-8-sig")
    css = (ROOT / "styles.css").read_text(encoding="utf-8-sig")
    js = (ROOT / "app.js").read_text(encoding="utf-8-sig")

    preloaded = {
        "data/" + name: json.loads((DATA_DIR / name).read_text(encoding="utf-8-sig"))
        for name in DATA_FILES
    }

    fetch_shim = (
        "<script>\n"
        "window.__PRELOADED_DATA__ = " + json.dumps(preloaded) + ";\n"
        "(function () {\n"
        "  var origFetch = window.fetch.bind(window);\n"
        "  window.fetch = function (url, opts) {\n"
        "    if (typeof url === 'string' && window.__PRELOADED_DATA__[url] !== undefined) {\n"
        "      return Promise.resolve(new Response(JSON.stringify(window.__PRELOADED_DATA__[url]), {\n"
        "        status: 200, headers: { 'Content-Type': 'application/json' }\n"
        "      }));\n"
        "    }\n"
        "    return origFetch(url, opts);\n"
        "  };\n"
        "})();\n"
        "</script>\n"
    )

    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>",
    )
    html = html.replace(
        '<script src="app.js"></script>',
        fetch_shim + "<script>\n" + js + "\n</script>",
    )
    return html


components.html(build_html(), height=2600, scrolling=True)
