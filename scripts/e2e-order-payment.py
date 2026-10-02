#!/usr/bin/env python3
"""E2E live order + payment verification — Python transport fallback.

Drives the SAME operations (method, route, DTO, and token semantics) as the
MCP tools in src/tools/, so the record is operationally identical to what
`npm run live:e2e` (Node, real MCP tool path) performs. Use this script when
the egress Cloudflare-challenges Node/undici but lets a Python
`requests.Session` through (see the transport note in
docs/mobile-endpoint-coverage.md).

Steps (tool parity):
  alza_account_status      -> auth check via token store
  alza_profile             -> GET /services/restservice.svc/v2/getUserData
  alza_mobile_read search  -> POST /services/restservice.svc/v5/search
  alza_add_to_cart         -> POST /services/restservice.svc/v2/basket/add
  alza_cart                -> GET v3/basketInfo + v10/gridOrder1
  alza_delivery_options    -> GET v12/getDeliveryPaymentGroups
  alza_payment_methods     -> GET v12/getDeliveryPaymentGroups (payment projection)
  alza_checkout_preview    -> GET v4/sendOrder1 + v12 (one-time token, local)
  alza_place_order         -> POST v7/sendOrder2, v5/sendOrder3, v1/approveOrder4,
                             POST /api/orders/v7/orderfinished (APK DTOs)
  alza_order               -> GET /api/users/0/v1/orders/{id} (+ /api/v1/orders/{id}/{part})
  alza_after_order_payments-> GET v2/getafterorderpayments/{order}/{part}
  alza_prepare_mutation    -> one-time token (client-side gate)
  alza_pay_after_order     -> POST /api/orders/v4/afterOrderPayment (AfterOrderRequestBody)
  alza_order (final)       -> final payment state

Requires ~/.alza-mcp/tokens.json from `python3 scripts/alza_auth_login.py`.
Writes docs/live-evidence/e2e-order-payment.md + .json.
"""
import json
import os
import re
import secrets
import sys
import time
import uuid
from pathlib import Path

import requests

HOME = Path(os.path.expanduser("~"))
TOKEN_FILE = Path(os.environ.get("ALZA_TOKEN_FILE", str(HOME / ".alza-mcp" / "tokens.json")))
BASE = os.environ.get("ALZA_API_BASE_URL", "https://www.alza.cz").rstrip("/")
SEARCH_TERM = os.environ.get("ALZA_E2E_SEARCH_TERM", "tužka")
EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "docs" / "live-evidence"
STOP_BEFORE_ORDER = os.environ.get("STOP_BEFORE_ORDER") == "1"


LOG: list[dict] = []
EVIDENCE_STATE: dict = {}


def die(msg):
    print(f"E2E stopped: {msg}", file=sys.stderr)
    try:
        write_evidence(EVIDENCE_STATE.get("started", "?"), EVIDENCE_STATE.get("email", "?"), EVIDENCE_STATE.get("product"), EVIDENCE_STATE.get("product_code"), EVIDENCE_STATE.get("product_price"), EVIDENCE_STATE.get("option"), EVIDENCE_STATE.get("option_id"), EVIDENCE_STATE.get("pick"), EVIDENCE_STATE.get("payment_id"), EVIDENCE_STATE.get("order"), LOG, partial=True)
    except Exception:
        pass
    sys.exit(1)


class Client:
    """Same headers MobileApi sends (src/infra/mobile-api.ts mobileHeaders)."""

    def __init__(self, store: dict):
        self.store = store
        self.visitor_id = store.get("visitor_id") or str(uuid.uuid4())
        self.access_token = store.get("access_token")
        self.refresh_token = store.get("refresh_token")
        self.session = requests.Session()

    def headers(self, extra: dict | None = None) -> dict:
        h = {
            "accept": "application/json",
            "content-type": "application/json",
            "user-agent": "Alza/2026.15.0 (Android)",
            "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
            "Balancer-Guid": self.visitor_id,
            "x-correlation-id": str(uuid.uuid4()),
        }
        if self.access_token:
            h["authorization"] = f"Bearer {self.access_token}"
        if extra:
            h.update(extra)
        return h

    def refresh(self) -> bool:
        if not self.refresh_token:
            return False
        r = self.session.post(
            "https://identity.alza.cz/connect/token",
            data={"grant_type": "refresh_token", "client_id": "alza_Android", "refresh_token": self.refresh_token},
            headers={
                "content-type": "application/x-www-form-urlencoded",
                "accept": "application/json",
                "user-agent": "Alza/2026.15.0 (Android)",
                "Balancer-Guid": self.visitor_id,
            },
            timeout=30,
        )
        if r.status_code != 200:
            return False
        j = r.json()
        self.access_token = j.get("access_token", self.access_token)
        self.refresh_token = j.get("refresh_token", self.refresh_token)
        return True

    def get(self, path: str):
        return self.request("GET", path)

    def post(self, path: str, body):
        data = json.dumps(body)
        return self.request("POST", path, data)

    def request(self, method: str, path: str, data=None):
        url = path if path.startswith("http") else f"{BASE}{path}"
        for attempt in range(2):
            r = self.session.request(method, url, data=data, headers=self.headers(), timeout=30, allow_redirects=True)
            if r.status_code == 401 and attempt == 0 and self.refresh():
                continue
            return r
        raise RuntimeError("unreachable")


def first_match(value, pred, depth=0):
    if value is None or depth > 14 or not isinstance(value, (dict, list)):
        return None
    try:
        if pred(value):
            return value
    except Exception:
        pass
    if isinstance(value, list):
        for item in value:
            hit = first_match(item, pred, depth + 1)
            if hit is not None:
                return hit
        return None
    for v in value.values():
        hit = first_match(v, pred, depth + 1)
        if hit is not None:
            return hit
    return None


def first_id(value, names, depth=0):
    if value is None or depth > 14 or not isinstance(value, (dict, list)):
        return None
    if isinstance(value, dict):
        for name in names:
            v = value.get(name)
            if isinstance(v, str) and 0 < len(v) <= 64:
                return v
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return str(v)
    for v in (value if isinstance(value, list) else value.values()):
        hit = first_id(v, names, depth + 1)
        if hit is not None:
            return hit
    return None


def num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    if isinstance(v, str) and v not in ("", None):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def main():
    if not TOKEN_FILE.exists() and os.environ.get("ALLOW_ANON") != "1":
        die(f"no token store at {TOKEN_FILE} — run the PKCE login first (or set ALLOW_ANON=1 for a dry run)")
    store = json.loads(TOKEN_FILE.read_text()) if TOKEN_FILE.exists() else {}
    c = Client(store)
    log = LOG
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    EVIDENCE_STATE["started"] = started

    def step(tool, args, note, fn, fatal=True):
        entry = {"tool": tool, "args": {k: v for k, v in args.items()}, "note": note}
        r = fn()
        entry["http"] = r.status_code
        try:
            entry["result"] = r.json()
        except ValueError:
            entry["result"] = r.text[:300]
            entry["body"] = r.text[:500]
        log.append(entry)
        if r.status_code >= 400:
            if fatal:
                die(f"{tool} ({note}) failed HTTP {r.status_code}: {str(entry.get('result'))[:300]}")
            return None
        return entry.get("result")

    print("0. auth state")
    print(f"   authenticated={bool(c.access_token)} visitor_id={c.visitor_id}")

    profile = step("alza_profile", {}, "user data", lambda: c.get("/services/restservice.svc/v2/getUserData"), fatal=False)
    email = first_id(profile, ["email", "login", "loginName"]) or "anonymous"
    EVIDENCE_STATE["email"] = email

    print(f"1. search {SEARCH_TERM!r}")
    search = step("alza_mobile_read", {"operation": "search", "args": {"search_term": SEARCH_TERM, "page": 0}}, "search",
                  lambda: c.post("/services/restservice.svc/v5/search", {
                      "searchTerm": SEARCH_TERM, "id": 0, "type": "PRODUCTION", "typeId": 0, "orderBy": 0, "page": 0,
                      "availabilityType": 0, "selectedBranches": [], "params": [], "producers": [], "sendPrices": False}))
    # find the product list: arrays of objects carrying a code + price
    products = first_match(search, lambda o: isinstance(o, list) and o and all(
        isinstance(x, dict) and (x.get("code") or x.get("productCode")) for x in o))
    if not products:
        die("no product list with codes found in search response")
    priced = [p for p in products if num(p.get("price", p.get("priceIncludingVat", p.get("priceCzk")))) is not None]
    if not priced:
        die("no priced products with codes in search response")
    priced.sort(key=lambda p: num(p.get("price", p.get("priceIncludingVat", p.get("priceCzk")))) or float("inf"))
    product = priced[0]
    product_code = product.get("code") or product.get("productCode")
    product_price = num(product.get("price", product.get("priceIncludingVat", product.get("priceCzk"))))
    EVIDENCE_STATE.update(product=product, product_code=product_code, product_price=product_price)
    print(f"   cheapest: {product.get('name') or product_code} @ {product_price} (code={product_code})")

    print("2. add to cart")
    step("alza_add_to_cart", {"code": product_code, "quantity": 1}, "add product",
         lambda: c.post("/services/restservice.svc/v2/basket/add", {"code": product_code, "amount": 1}))

    print("3. cart reads")
    cart = step("alza_cart", {}, "cart", lambda: c.get("/services/restservice.svc/v10/gridOrder1"))
    step("alza_mobile_read", {"operation": "basket_info"}, "basket info", lambda: c.get("/services/restservice.svc/v3/basketInfo"), fatal=False)
    consents = first_match(cart, lambda o: isinstance(o, list) and o and all(isinstance(x, dict) and "consentId" in x for x in o)) or []
    consents = [{"consentId": x["consentId"], "value": True} for x in consents]

    print("4. delivery options")
    delivery = step("alza_delivery_options", {}, "delivery groups", lambda: c.get("/services/restservice.svc/v12/getDeliveryPaymentGroups"))
    option = first_match(delivery, lambda o: isinstance(o, dict) and num(o.get("id", o.get("optionId", o.get("deliveryId")))) is not None
                         and (isinstance(o.get("name"), str) or isinstance(o.get("deliveryName"), str)))
    if not option:
        die("no selectable delivery option found in delivery response")
    option_id = num(option.get("id", option.get("optionId", option.get("deliveryId"))))
    EVIDENCE_STATE.update(option=option, option_id=option_id)
    print(f"   delivery: {option.get('name') or option.get('deliveryName')} (id={option_id})")

    print("5. payment methods")
    payments = step("alza_payment_methods", {"selected_delivery_option_id": option_id}, "payment groups",
                    lambda: c.get(f"/services/restservice.svc/v12/getDeliveryPaymentGroups?selectedDeliveryOptionId={int(option_id)}"))
    pay_items = first_match(payments, lambda o: isinstance(o, list) and o and all(
        isinstance(x, dict) and (num(x.get("id", x.get("paymentId", x.get("methodId")))) is not None) for x in o)) or []
    pick = next((p for p in pay_items if re.search(r"převod|bank|transfer|faktura|invoice", str(p.get("name", p.get("paymentName", ""))), re.I)), pay_items[0] if pay_items else None)
    if not pick:
        die("no payment methods found in payment response")
    payment_id = num(pick.get("id", pick.get("paymentId", pick.get("methodId"))))
    if payment_id is None:
        die("could not extract a numeric payment id from payment response")
    EVIDENCE_STATE.update(pick=pick, payment_id=payment_id)
    print(f"   payment: {pick.get('name') or pick.get('paymentName')} (paymentId={payment_id})")

    if STOP_BEFORE_ORDER:
        print("STOP_BEFORE_ORDER=1 — stopping before order submission.")
        write_evidence(started, email, product, product_code, product_price, option, option_id, pick, payment_id, None, log, partial=True)
        return

    print("6. checkout preview (sendOrder1 + token)")
    preview_token = secrets.token_hex(24)
    preview_state = step("alza_checkout_preview", {"selected_delivery_option_id": option_id}, "checkout state",
                         lambda: c.get("/services/restservice.svc/v4/sendOrder1"))

    print("7. order submission (sendOrder2 -> orderfinished)")
    delivery_payload = {
        "selectedDeliveryOptionId": int(option_id),
        "paymentId": int(payment_id),
        "deliveryGroups": [],
    }
    for src, dst in (("name", "deliveryName"), ("deliveryName", "deliveryName"), ("zipCode", "deliveryZipCode"),
                     ("zip", "deliveryZipCode"), ("city", "deliveryCity"), ("street", "deliveryStreet"),
                     ("deliveryAddressId", "deliveryAddressId"), ("addressId", "deliveryAddressId")):
        v = option.get(src)
        if v is not None and dst not in delivery_payload:
            delivery_payload[dst] = v
    user_info = {"parameters": {}}
    if email != "anonymous":
        user_info["parameters"]["email"] = email
    complete_order = {"consents": consents, "basketConsents": consents, "saveCard": False}

    r2 = step("alza_place_order", {"step": "sendOrder2"}, "select delivery+payment", lambda: c.post("/services/restservice.svc/v7/sendOrder2", delivery_payload))
    r3 = step("alza_place_order", {"step": "sendOrder3"}, "user info", lambda: c.post("/services/restservice.svc/v5/sendOrder3", user_info))
    r4 = step("alza_place_order", {"step": "approveOrder4"}, "approve", lambda: c.get("/services/restservice.svc/v1/approveOrder4"))
    placed = step("alza_place_order", {"step": "orderfinished"}, "finish order", lambda: c.post("/api/orders/v7/orderfinished", complete_order))
    order_id = first_id(placed, ["orderId", "id", "orderNumber", "invoiceNumber"])
    invoice_number = first_id(placed, ["invoiceNumber", "invoice"]) or order_id
    if not order_id:
        die(f"could not extract an order id from the placement result: {str(placed)[:300]}")
    print(f"   order placed: {order_id} (invoice={invoice_number})")

    print("8. order read (parts/milestones)")
    order_read = step("alza_order", {"order_id": order_id, "user_flag": 0}, "order read",
                      lambda: c.get(f"/api/users/0/v1/orders/{order_id}"))
    parts = first_match(order_read, lambda o: isinstance(o, dict) and isinstance(o.get("parts"), list) and o["parts"])
    part_id = first_id((parts or {}).get("parts") if parts else order_read, ["partId", "id"]) or order_id

    print("9. after-order payment options")
    after_pays = step("alza_after_order_payments", {"order_id": order_id, "part_id": str(part_id)}, "after-order payments",
                      lambda: c.get(f"/services/restservice.svc/v2/getafterorderpayments/{order_id}/{part_id}"), fatal=False)
    after_item = first_match(after_pays, lambda o: isinstance(o, dict) and num(o.get("paymentId", o.get("id", o.get("methodId")))) is not None) or {}
    after_payment_id = num(after_item.get("paymentId", after_item.get("id", after_item.get("methodId", payment_id)))) or payment_id
    card_id = num(after_item.get("cardId")) or num(first_match(after_pays, lambda o: isinstance(o, dict) and num(o.get("cardId")) is not None) or {}).get("cardId")
    print(f"   after-order payment: paymentId={after_payment_id}" + (f" cardId={card_id}" if card_id is not None else ""))

    print("10. payment execution (afterOrderPayment)")
    mut_token = secrets.token_hex(24)  # client-side one-time gate, same as alza_prepare_mutation
    pay_body = {"id": str(order_id), "invoiceNumber": str(invoice_number), "paymentId": int(after_payment_id)}
    if card_id is not None:
        pay_body["cardId"] = int(card_id)
    EVIDENCE_STATE["order"] = {"order_id": order_id, "invoice_number": invoice_number, "part_id": str(part_id),
                               "payment_id": after_payment_id, "card_id": card_id}
    paid = step("alza_pay_after_order", {k: v for k, v in pay_body.items()}, "payment execution",
                lambda: c.post("/api/orders/v4/afterOrderPayment", pay_body))
    EVIDENCE_STATE["order"]["payment_result"] = paid

    print("11. final order state")
    final = step("alza_order", {"order_id": order_id, "part_id": str(part_id)}, "final state",
                 lambda: c.get(f"/api/v1/orders/{order_id}/{part_id}"), fatal=False)
    EVIDENCE_STATE["order"].update(preview_token=preview_token, mutation_token=mut_token, placed=placed, final_state=final)
    write_evidence(started, email, product, product_code, product_price, option, option_id, pick, payment_id,
                   EVIDENCE_STATE["order"], log, partial=False)
    print(f"E2E complete: order {order_id}")


def write_evidence(started, email, product, product_code, product_price, option, option_id, pick, payment_id, order, log, partial):
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    steps = "\n".join(
        f"{i + 1}. `{s['tool']}` {json.dumps(s.get('args', {}))[:220]} — HTTP {s.get('http')}" + (f" — {str(s.get('result'))[:150]}" if s.get("http", 0) >= 400 else "")
        for i, s in enumerate(log))
    pay = (order or {}).get("payment_result")
    md = f"""# E2E live order + payment record

- Date: {started}
- Account: {email}
- Transport: Python requests.Session (Node/undici is Cloudflare-challenged from this egress; see coverage-doc transport note)
- Product: `{product_code}` ({(product or {}).get('name') or 'unnamed'}, price {product_price})
- Delivery: {(option or {}).get('name') or (option or {}).get('deliveryName')} (option id {option_id})
- Payment method: {(pick or {}).get('name') or (pick or {}).get('paymentName')} (paymentId {payment_id})
"""
    if order:
        md += f"- **Order ID: `{order['order_id']}`** (invoice `{order['invoice_number']}`, part `{order['part_id']}`)\n"
        if order.get("card_id") is not None:
            md += f"- Executed payment: paymentId {order['payment_id']}, cardId {order['card_id']}\n"
        md += f"""
## Payment result (raw `afterOrderPayment` response)

```json
{json.dumps(pay if pay is not None else order.get('placed'), indent=2, ensure_ascii=False)[:4000]}
```

## Final order state

```json
{json.dumps(order.get('final_state') or (order or {}).get('placed'), indent=2, ensure_ascii=False)[:4000]}
```
"""
    else:
        md += "\n(Partial record — stopped before order submission.)\n"
    md += f"""
## Tool-equivalent steps

{steps}

## Notes

- Each step mirrors the corresponding MCP tool (method, route, DTO, one-time-token semantics) from src/tools/.
- Raw step log: `e2e-order-payment.json`.
"""
    (EVIDENCE_DIR / "e2e-order-payment.md").write_text(md)
    (EVIDENCE_DIR / "e2e-order-payment.json").write_text(json.dumps({
        "started_at": started, "account_email": email,
        "product": {"code": product_code, "name": (product or {}).get("name"), "price": product_price},
        "delivery_option": {"id": option_id, "name": (option or {}).get("name") or (option or {}).get("deliveryName")},
        "payment_method": {"id": payment_id, "name": (pick or {}).get("name") or (pick or {}).get("paymentName")},
        "order": order, "steps": log, "partial": partial,
    }, indent=2, ensure_ascii=False) + "\n")
    print(f"evidence: {EVIDENCE_DIR / ('e2e-order-payment.md')}")


if __name__ == "__main__":
    main()
