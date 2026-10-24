"""用炸鸡英文标题（截图1真实存在的品）触发 collect-batch-apply 单行"""
import json
import urllib.request

url = "http://127.0.0.1:3000/api/dianxiaomi/collect-batch-apply"
payload = {
    "rows": [{
        "packageName": "炸鸡翅腿钥匙扣_英文",  # 全新包名,避免覆盖已归档
        "category": "auto",
        "searchTitle": "Fried Chicken Keychain Realistic Food Bag Charm For Backpack Purse Keys Food Lovers Birthday Party And Everyday Gift,Accessory",
        "productTemplate": "箱包配件-包饰"
    }],
    "operationId": f"test-markCollect-en-{__import__('time').time()}"
}
print("PAYLOAD:", json.dumps(payload, ensure_ascii=False)[:300])
req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                              headers={"Content-Type": "application/json; charset=utf-8"})
r = urllib.request.urlopen(req, timeout=8)
print("HTTP", r.status, r.read().decode("utf-8"))
