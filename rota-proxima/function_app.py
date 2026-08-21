import azure.functions as func
from azure.identity import ManagedIdentityCredential
import os, json, base64, re, unicodedata
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote
from datetime import datetime

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

GRAPH = "https://graph.microsoft.com/v1.0"

def _safe_name(value: str, fallback="Sem nome"):
    value = (value or fallback).strip()
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "-", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:120] or fallback

def _token():
    client_id = os.environ.get("AZURE_CLIENT_ID")
    if not client_id:
        raise RuntimeError("AZURE_CLIENT_ID não configurado.")
    cred = ManagedIdentityCredential(client_id=client_id)
    return cred.get_token("https://graph.microsoft.com/.default").token

def _graph(method, path, token, body=None, content_type="application/json"):
    data = None
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode("utf-8")
        else:
            data = body
        headers["Content-Type"] = content_type
    req = Request(GRAPH + path, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=45) as r:
            raw = r.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Graph HTTP {e.code}: {raw}") from e

def _find_child(drive_id, parent_id, name, token):
    for item in _folder_children(drive_id, parent_id, token):
        if item.get("name", "").casefold() == name.casefold() and "folder" in item:
            return item["id"]
    return None

def _folder_children(drive_id, parent_id, token):
    path = (
        f"/drives/{quote(drive_id, safe='')}/items/{quote(parent_id, safe='')}"
        "/children?$select=id,name,folder,createdDateTime&$top=999"
    )
    return [item for item in _graph("GET", path, token).get("value", []) if "folder" in item]

def _select_keyed_folder(items, key_prefix, expected_name, fallback_name):
    """Seleciona a pasta canônica pelo ID estável, sem confiar no rótulo mutável."""
    prefix = key_prefix.casefold()
    expected = expected_name.casefold()
    fallback = fallback_name.casefold()
    matches = [item for item in items if item.get("name", "").casefold().startswith(prefix)]
    if not matches:
        return None

    def score(item):
        name = item.get("name", "").casefold()
        descriptive = name != fallback
        child_count = int((item.get("folder") or {}).get("childCount") or 0)
        exact = expected != fallback and name == expected
        # Em empate, a pasta mais antiga já estabelecida tem prioridade.
        try:
            created_rank = -datetime.fromisoformat(
                str(item.get("createdDateTime") or "").replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            created_rank = float("-inf")
        return (descriptive, child_count, exact, created_rank)

    return max(matches, key=score)

def _ensure_keyed_folder(drive_id, parent_id, key_prefix, expected_name, fallback_name, token):
    selected = _select_keyed_folder(
        _folder_children(drive_id, parent_id, token),
        key_prefix,
        expected_name,
        fallback_name,
    )
    if selected:
        return selected["id"], selected["name"]

    path = f"/drives/{quote(drive_id, safe='')}/items/{quote(parent_id, safe='')}/children"
    try:
        item = _graph("POST", path, token, {
            "name": expected_name,
            "folder": {},
            "@microsoft.graph.conflictBehavior": "fail"
        })
        return item["id"], item.get("name") or expected_name
    except RuntimeError as exc:
        selected = _select_keyed_folder(
            _folder_children(drive_id, parent_id, token),
            key_prefix,
            expected_name,
            fallback_name,
        )
        if selected:
            return selected["id"], selected["name"]
        raise exc

def _ensure_folder(drive_id, parent_id, name, token):
    existing = _find_child(drive_id, parent_id, name, token)
    if existing:
        return existing
    path = f"/drives/{quote(drive_id, safe='')}/items/{quote(parent_id, safe='')}/children"
    try:
        item = _graph("POST", path, token, {
            "name": name,
            "folder": {},
            "@microsoft.graph.conflictBehavior": "fail"
        })
        return item["id"]
    except RuntimeError as exc:
        # Se outra chamada criou a pasta ao mesmo tempo, procura novamente.
        existing = _find_child(drive_id, parent_id, name, token)
        if existing:
            return existing
        raise exc

@app.route(route="health", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"ok": True, "service": "func-rota-proxima", "storage": "sharepoint"}),
        mimetype="application/json",
        status_code=200,
    )

@app.route(route="upload-rota-pev", methods=["POST"])
def upload_rota_pev(req: func.HttpRequest) -> func.HttpResponse:
    try:
        payload = req.get_json()

        required = ["route_id", "pev_name", "evidence_type", "filename", "content_base64"]
        missing = [k for k in required if not payload.get(k)]
        if missing:
            return func.HttpResponse(
                json.dumps({"ok": False, "error": "Campos obrigatórios ausentes", "missing": missing}),
                mimetype="application/json",
                status_code=400,
            )

        drive_id = os.environ.get("SHAREPOINT_DRIVE_ID")
        root_folder_id = os.environ.get("SHAREPOINT_ROOT_FOLDER_ID")
        if not drive_id or not root_folder_id:
            raise RuntimeError("SHAREPOINT_DRIVE_ID/SHAREPOINT_ROOT_FOLDER_ID não configurados.")

        token = _token()

        now = datetime.now()
        year = str(payload.get("year") or now.year)
        month_num = int(payload.get("month") or now.month)
        month_names = [
            "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
            "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
        ]
        month = f"{month_num:02d} - {month_names[month_num-1]}"

        route_id = str(payload["route_id"])
        route_name = _safe_name(payload.get("route_name") or f"Rota {route_id}")
        route_folder = _safe_name(f"Rota {int(route_id):05d} - {route_name}" if route_id.isdigit() else route_name)
        route_key = f"Rota {int(route_id):05d} -" if route_id.isdigit() else route_folder
        route_fallback = _safe_name(f"Rota {int(route_id):05d} - Rota {int(route_id)}" if route_id.isdigit() else route_name)

        pev_name = _safe_name(payload["pev_name"])
        pev_id = str(payload.get("pev_id") or "").strip()
        if pev_id.isdigit():
            pev_folder = _safe_name(f"PEV {int(pev_id):04d} - {pev_name}")
            pev_key = f"PEV {int(pev_id):04d} -"
            pev_fallback = _safe_name(f"PEV {int(pev_id):04d} - PEV {int(pev_id)}")
        else:
            # Compatibilidade com chamadas antigas que ainda não enviem pev_id.
            pev_folder = pev_name
            pev_key = pev_folder
            pev_fallback = pev_folder

        filename = _safe_name(payload["filename"], "foto.jpg")

        # Estrutura reduzida: Ano -> Mês -> Rota -> PEV. Rota e PEV são
        # localizados pelo prefixo com ID; seus nomes podem mudar ou ficar
        # temporariamente invisíveis após a pesagem sem criar outra pasta.
        # LOCAL/TAMBOR/PESAGEM passam a ser identificados pelo nome do arquivo,
        # evitando criar uma subpasta adicional para cada tipo de evidência.
        parent = root_folder_id
        for segment in [year, month]:
            parent = _ensure_folder(drive_id, parent, segment, token)
        parent, route_folder = _ensure_keyed_folder(
            drive_id, parent, route_key, route_folder, route_fallback, token
        )
        parent, pev_folder = _ensure_keyed_folder(
            drive_id, parent, pev_key, pev_folder, pev_fallback, token
        )

        try:
            content = base64.b64decode(payload["content_base64"], validate=True)
        except Exception:
            return func.HttpResponse(
                json.dumps({"ok": False, "error": "content_base64 inválido"}),
                mimetype="application/json",
                status_code=400,
            )

        if len(content) > 20 * 1024 * 1024:
            return func.HttpResponse(
                json.dumps({"ok": False, "error": "Arquivo acima do limite de 20 MB desta função."}),
                mimetype="application/json",
                status_code=413,
            )

        upload_path = (
            f"/drives/{quote(drive_id, safe='')}/items/{quote(parent, safe='')}:"
            f"/{quote(filename, safe='')}:/content"
        )
        item = _graph("PUT", upload_path, token, content, "application/octet-stream")

        return func.HttpResponse(
            json.dumps({
                "ok": True,
                "id": item.get("id"),
                "name": item.get("name"),
                "webUrl": item.get("webUrl"),
                "size": item.get("size"),
                "folder": f"{year}/{month}/{route_folder}/{pev_folder}",
            }, ensure_ascii=False),
            mimetype="application/json",
            status_code=200,
        )
    except Exception as exc:
        return func.HttpResponse(
            json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False),
            mimetype="application/json",
            status_code=500,
        )
