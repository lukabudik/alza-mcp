#!/usr/bin/env python3
"""Bounded, read-only compatibility matrix for APK-confirmed Alza routes."""
import json, os, time, uuid
from urllib.parse import urljoin
import requests

base = os.environ.get("ALZA_API_BASE_URL")
if not base:
    raise SystemExit("Set ALZA_API_BASE_URL explicitly")
base = base.rstrip("/") + "/"

session = requests.Session()
visitor_id = str(uuid.uuid4())
headers = {
    "Accept": "application/json",
    "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    "User-Agent": "ktor-client",
    "Balancer-Guid": str(uuid.uuid4()),
    "x-correlation-id": str(uuid.uuid4()),
}

product_id = 12464593
checks = [
    ("oidc-discovery", "https://identity.alza.cz/.well-known/openid-configuration", "GET", None),
    ("catalog-navigation", "/api/catalog/v2/homePage/userNavigation", "GET", None),
    ("visitor-navigation", "/api/visitors/{visitor}/mainNavigation", "GET", None),
    ("url-info", "/api/catalog/v1/homePage/getUrlInfo", "POST", {"url": "/"}),
    ("category", "/api/catalog/v1/homePage/categories/1", "GET", None),
    ("category-detail", "/services/restservice.svc/v1/category/1?type=CATEGORY&typeId=0", "GET", None),
    ("facets", "/services/restservice.svc/v3/params/1?type=CATEGORY&typeId=0&search=", "GET", None),
    ("search", "/services/restservice.svc/v5/search", "POST", {"searchTerm":"notebook","id":0,"type":"PRODUCTION","typeId":0,"orderBy":0,"page":0,"availabilityType":0,"selectedBranches":[],"params":[],"producers":[],"sendPrices":False}),
    ("product-external", f"/api/legacy/catalog/v14/external/product/{product_id}", "GET", None),
    ("product-legacy", f"/api/legacy/catalog/v14/product/{product_id}", "GET", None),
    ("product-router", f"/api/router/legacy/catalog/product/{product_id}", "GET", None),
    ("alternatives", f"/services/restservice.svc/v1/alternatives/{product_id}", "GET", None),
    ("ean-empty", "/services/restservice.svc/v1/getProductByEANlist", "POST", {"eanList": []}),
    ("discussion-posts", f"/services/restservice.svc/v1/getCommodityDiscussionPosts?id={product_id}&pageStart=0&pageSize=25", "GET", None),
    ("branches-prague", "/api/branches/v1/cityBranches?latitude=50.0755&longitude=14.4378", "GET", None),
    ("zip-prague", "/services/restservice.svc/v1/getZipCodes?deliveryId=0&search=11000", "GET", None),
    ("delivery-countries", "/services/restservice.svc/v1/getAllDeliveryCountries", "GET", None),
    ("cart-info", "/services/restservice.svc/v3/basketInfo", "GET", None),
    ("cart-grid", "/services/restservice.svc/v10/gridOrder1", "GET", None),
    ("order-add-info", "/services/restservice.svc/v2/getOrderAddInfo?isGiftsEnabled=true", "GET", None),
    ("order2-info", "/services/restservice.svc/v8/getOrder2Info", "GET", None),
    ("o3-info", "/services/restservice.svc/v2/o3Info", "GET", None),
    ("commodity-lists", "/services/restservice.svc/v1/getCommodityLists", "GET", None),
    ("user-data-anonymous", "/services/restservice.svc/v2/getUserData", "GET", None),
    ("contacts-anonymous", "/services/restservice.svc/v4/contacts", "GET", None),
    ("login-name-check", "/services/restservice.svc/v1/validateLoginName?email=invalid-test@example.invalid", "GET", None),
    ("anonymous-orders-invalid", "/api/anonymous/v1/orders?invoiceNumber=TEST-NONEXISTENT", "GET", None),
    ("anonymous-order-invalid", "/api/anonymous/v1/orders/TEST-NONEXISTENT", "GET", None),
    ("user-order-unauthenticated", "/api/users/0/v1/orders/TEST-NONEXISTENT?initialCreated=1", "GET", None),
    ("order-part-invalid", "/api/v1/orders/TEST-NONEXISTENT/TEST", "GET", None),
    ("helpdesk-questions", "/api/orders/v1/helpdesk/questions", "GET", None),
]

for i, (name, path, method, payload) in enumerate(checks):
    path = path.replace("{visitor}", visitor_id)
    url = path if path.startswith("http") else urljoin(base, path.lstrip("/"))
    try:
        if method == "POST":
            response = session.post(url, headers=headers, json=payload, timeout=30, allow_redirects=True)
        else:
            response = session.get(url, headers=headers, timeout=30, allow_redirects=True)
        result = {
            "name": name,
            "status": response.status_code,
            "content_type": response.headers.get("content-type", ""),
            "cf_mitigated": response.headers.get("cf-mitigated", ""),
            "body_bytes": len(response.content),
            "final_path": response.url.split("?", 1)[0].replace(base.rstrip("/"), ""),
        }
        if "identity.alza.cz" in url:
            result["origin"] = "identity"
        print(json.dumps(result, ensure_ascii=False))
    except requests.RequestException as exc:
        print(json.dumps({"name": name, "error": type(exc).__name__}))
    time.sleep(0.35)
