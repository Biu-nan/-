"""触发 collect-batch-apply 单行炸鸡，跑完后看 markCollect 实际效果"""
import json
import urllib.request
import urllib.error

url = "http://127.0.0.1:3000/api/dianxiaomi/collect-batch-apply"
payload = {
    "rows": [{
        "packageName": "炸鸡翅腿钥匙扣",
        "category": "auto",
        "searchTitle": "仿真PVC食礼物品玩创意炸鸡翅腿薯条模型学生批发钥匙圈扣挂件饰",
        "factsPath": "已完成产品/炸鸡翅腿钥匙扣/product-facts.json",
        "productTemplate": "箱包配件-包饰"
    }],
    "operationId": f"test-markCollect-{__import__('time').time()}"
}
print("PAYLOAD:", json.dumps(payload, ensure_ascii=False))
req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                              headers={"Content-Type": "application/json; charset=utf-8"})
try:
    r = urllib.request.urlopen(req, timeout=8)
    print("HTTP", r.status, r.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("HTTP ERR", e.code, e.read().decode("utf-8"))
