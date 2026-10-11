"""Adapt the pinned client to a silent, sandboxed computer screen."""
from pathlib import Path
import re

for path in Path("/usr/share/selkies/web/assets").glob("index-*.js"):
    source = path.read_text()
    for signature in ("async function Te(){", "async function Ie(){"):
        if source.count(signature) != 1:
            raise RuntimeError("Selkies client changed; review the audio initialization adapter")
        source = source.replace(signature, signature + "if(window.audio_enabled===false)return;")
    # Self-messages have origin "null" inside the existing opaque screen iframe.
    source, negative = re.subn(r"([\w$]+)\.origin!==window.location.origin", r"(\1.source!==window&&\1.origin!==window.location.origin)", source)
    source, positive = re.subn(r"([\w$]+)\.origin===window.location.origin", r"(\1.source===window||\1.origin===window.location.origin)", source)
    if negative != 4 or positive != 1:
        raise RuntimeError("Selkies messaging changed; review the sandbox adapter")
    path.write_text(source)
