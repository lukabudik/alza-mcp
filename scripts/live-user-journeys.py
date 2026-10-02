#!/usr/bin/env python3
import json, os, time, uuid
from urllib.parse import urljoin
import requests

base = os.environ.get("ALZA_API_BASE_URL")
if not base:
    raise SystemExit("Set ALZA_API_BASE_URL explicitly")
base = base.rstrip("/") + "/"
s = requests.Session()
h = {"Accept":"application/json","Accept-Language":"cs-CZ,cs;q=0.9,en;q=0.8","User-Agent":"ktor-client","Balancer-Guid":str(uuid.uuid4()),"x-correlation-id":str(uuid.uuid4())}


def call(name, path, method="GET", payload=None):
    url = path if path.startswith("http") else urljoin(base, path.lstrip("/"))
    if method == "POST": r = s.post(url, headers=h, json=payload, timeout=30, allow_redirects=True)
    else: r = s.get(url, headers=h, timeout=30, allow_redirects=True)
    item = {"step": name, "status": r.status_code, "content_type": r.headers.get("content-type", ""), "cf_mitigated": r.headers.get("cf-mitigated", ""), "bytes": len(r.content)}
    try: data = r.json()
    except ValueError: data = None
    return r, data, item


def emit(journey, steps):
    print(json.dumps({"journey": journey, "steps": steps}, ensure_ascii=False))

# Catalog journey: canonical navigation, search, product detail, alternatives, discussion.
steps=[]
r, nav, x = call("navigation", "/api/catalog/v2/homePage/userNavigation"); steps.append(x)
r, search, x = call("search", "/services/restservice.svc/v5/search", "POST", {"searchTerm":"notebook","id":0,"type":"PRODUCTION","typeId":0,"orderBy":0,"page":0,"availabilityType":0,"selectedBranches":[],"params":[],"producers":[],"sendPrices":False}); x["json_type"] = type(search).__name__; x["top_keys"] = sorted(search.keys())[:8] if isinstance(search, dict) else []; steps.append(x)
r, product, x = call("product", "/api/legacy/catalog/v14/external/product/12464593"); x["json_type"] = type(product).__name__; x["top_keys"] = sorted(product.keys())[:8] if isinstance(product, dict) else []; steps.append(x)
r, alternatives, x = call("alternatives", "/services/restservice.svc/v1/alternatives/12464593"); x["json_type"] = type(alternatives).__name__; steps.append(x)
r, discussions, x = call("discussion-posts", "/services/restservice.svc/v1/getCommodityDiscussionPosts?id=12464593&pageStart=0&pageSize=25"); x["json_type"] = type(discussions).__name__; steps.append(x)
emit("catalog-product", steps)

# Location/delivery/cart journey; read-only and leaves cart unchanged.
steps=[]
for name,path in [("branches","/api/branches/v1/cityBranches?latitude=50.0755&longitude=14.4378"),("zip-codes","/services/restservice.svc/v1/getZipCodes?deliveryId=0&search=11000"),("delivery-countries","/services/restservice.svc/v1/getAllDeliveryCountries"),("basket-info","/services/restservice.svc/v3/basketInfo"),("cart-grid","/services/restservice.svc/v10/gridOrder1"),("order-add-info","/services/restservice.svc/v2/getOrderAddInfo?isGiftsEnabled=true")]:
    _, data, x=call(name,path); x["json_type"]=type(data).__name__; steps.append(x); time.sleep(.35)
emit("location-delivery-cart-read", steps)

# Anonymous account boundary journey: safe reads and expected auth/empty-state responses.
steps=[]
for name,path in [("user-data","/services/restservice.svc/v2/getUserData"),("contacts","/services/restservice.svc/v4/contacts"),("lists","/services/restservice.svc/v1/getCommodityLists"),("anonymous-order-lookup","/api/anonymous/v1/orders/TEST-NONEXISTENT"),("authenticated-order-boundary","/api/users/0/v1/orders/TEST-NONEXISTENT?initialCreated=1"),("helpdesk","/api/orders/v1/helpdesk/questions")]:
    _, data, x=call(name,path); x["json_type"]=type(data).__name__; steps.append(x); time.sleep(.35)
emit("anonymous-account-boundary", steps)
