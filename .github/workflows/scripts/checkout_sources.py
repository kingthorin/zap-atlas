"""Clone/update upstream ZAP repos into ./sources and write sources_manifest.json.

Env: REF (single ref for all repos), REPO_REFS (JSON map of repo name -> ref).
"""
import json, os, subprocess
refs = json.loads(os.environ.get("REPO_REFS", "{}"))
single = os.environ.get("REF", "").strip()
repos = [
  ("zaproxy", "https://github.com/zaproxy/zaproxy.git"),
  ("zap-extensions", "https://github.com/zaproxy/zap-extensions.git"),
]
out = {}
for name, url in repos:
  ref = refs.get(name) or single or None
  dest = f"sources/{name}"
  if not os.path.isdir(dest):
    subprocess.run(["git", "clone", "--no-local", "--", url, dest], check=True)
  if not ref:
    sym = subprocess.check_output(
      ["git", "ls-remote", "--symref", url, "HEAD"], text=True
    )
    ref = "main"
    for line in sym.splitlines():
      if line.startswith("ref:"):
        r = line.split()[1]
        if r.startswith("refs/heads/"):
          ref = r[len("refs/heads/"):]
  subprocess.run(["git", "-C", dest, "fetch", "--tags", "--prune"], check=True)
  subprocess.run(["git", "-C", dest, "checkout", ref], check=True)
  subprocess.run(["git", "-C", dest, "reset", "--hard", ref], check=True)
  sha = subprocess.check_output(["git", "-C", dest, "rev-parse", "HEAD"], text=True).strip()
  out[name] = {"url": url, "sha": sha, "ref": ref}
  print(f"{name} @ {sha} (ref={ref})")
with open("sources_manifest.json", "w") as f:
  json.dump(out, f, indent=2)
