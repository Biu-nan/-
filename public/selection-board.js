/**
 * 选品看板（Selection Board）前端 —— 独立模块，不参与 app.js 的 1 秒全量重绘。
 *
 * 设计约束（沿用本项目既有踩坑教训）：
 *   1. 只在 [data-view-panel="selection-board"] 可见时轮询，不可见不发请求；
 *   2. 15 秒独立轮询 + 数据指纹比对，指纹不变就不重绘（避免打断正在输入的详情弹窗）；
 *   3. 详情弹窗打开期间暂停自动重绘，防止用户正在填的字段被刷掉；
 *   4. 所有渲染都走 esc()，不把后端字符串直接拼进 HTML。
 */
(function () {
  "use strict";

  var PANEL_SELECTOR = '[data-view-panel="selection-board"]';
  var API = "/api/selection-board";
  var POLL_MS = 15000;

  var board = null;
  var fingerprint = "";
  var filterStatus = "";
  var searchText = "";
  var openItemId = null;
  var busy = false;
  var pendingCreateFiles = [];

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function panel() {
    return $(PANEL_SELECTOR);
  }
  function panelVisible() {
    var node = panel();
    return Boolean(node && node.classList.contains("active"));
  }
  function statusMeta(id) {
    var list = (board && board.statuses) || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return { id: id, label: id || "未知", tone: "neutral", hint: "" };
  }
  function statusBadge(id) {
    var meta = statusMeta(id);
    return '<span class="board-status-badge tone-' + esc(meta.tone) + '">' + esc(meta.label) + "</span>";
  }
  function imgUrl(itemId, kind, name) {
    return API + "/items/" + encodeURIComponent(itemId) + "/" + kind + "/" + encodeURIComponent(name);
  }
  function formatTime(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "—";
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return (
      pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
    );
  }
  function notify(target, message, kind) {
    if (!target) return;
    target.textContent = message;
    target.className = "board-status" + (kind ? " " + kind : "");
  }

  function api(path, options) {
    var opts = options || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch(API + path, opts).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "请求失败（HTTP " + response.status + "）");
        }
        return body;
      });
    });
  }
  function upload(path, files) {
    var form = new FormData();
    Array.prototype.forEach.call(files, function (file) {
      form.append("images", file);
    });
    return fetch(API + path, { method: "POST", body: form }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : "上传失败（HTTP " + response.status + "）");
        }
        return body;
      });
    });
  }

  /* ══ 数据加载 ══ */
  function load(options) {
    var force = options && options.force;
    return api("").then(function (data) {
      var next = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
      var changed = next !== fingerprint;
      fingerprint = next;
      board = data;
      if (changed || force) {
        renderAll();
        if (openItemId && force) renderDetail(openItemId);
      }
      return data;
    }).catch(function (error) {
      var message = $("#sbBoardMessage", panel());
      if (message) {
        message.textContent = "看板加载失败：" + error.message + "（服务未启动或路由未挂载时会持续提示）";
        message.classList.add("is-error");
      }
    });
  }

  function renderAll() {
    renderMetrics();
    renderStatusFilter();
    renderTable();
  }

  /* Phase 1：状态从单一七态拆成三套独立状态。
     指标卡的 filterStatus 现在是「语义分组 key」，不是旧 status id。 */
  var METRIC_FILTERS = {
    "": function () {
      return true;
    },
    "data-entry": function (item) {
      return ["DISCOVERED", "DATA_ENTRY", "BLOCKED_INPUT"].indexOf(item.developmentStage) >= 0;
    },
    ready: function (item) {
      return item.developmentStage === "READY_FOR_LISTING";
    },
    listing: function (item) {
      return ["LISTING_IN_PROGRESS", "QC_PENDING", "QC_PASSED", "LISTING_READY"].indexOf(item.developmentStage) >= 0;
    },
    synced: function (item) {
      return item.dianxiaomiSyncStatus === "SYNCED";
    }
  };
  function metricPredicate(key) {
    return METRIC_FILTERS[key] || METRIC_FILTERS[""];
  }

  function renderMetrics() {
    var items = (board && board.items) || [];
    var map = {
      sbMetricTotal: items.length,
      sbMetricPicked: items.filter(METRIC_FILTERS["data-entry"]).length,
      sbMetricReady: items.filter(METRIC_FILTERS.ready).length,
      sbMetricListing: items.filter(METRIC_FILTERS.listing).length,
      sbMetricSaved: items.filter(METRIC_FILTERS.synced).length
    };
    Object.keys(map).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = String(map[id]);
    });
    $$("[data-sb-filter]", panel()).forEach(function (button) {
      button.classList.toggle("active", (button.dataset.sbFilter || "") === filterStatus);
    });
  }

  function renderStatusFilter() {
    var select = $("#sbStatusFilter", panel());
    if (!select || !board) return;
    var current = select.value;
    var items = board.items || [];
    var options = ['<option value="">全部开发阶段</option>'];
    (board.statuses || []).forEach(function (status) {
      var count = items.filter(function (item) {
        return item.developmentStage === status.id;
      }).length;
      options.push('<option value="' + esc(status.id) + '">' + esc(status.label) + " · " + count + "</option>");
    });
    select.innerHTML = options.join("");
    if (current) select.value = current;
  }

  function visibleItems() {
    var items = (board && board.items) || [];
    var keyword = searchText.trim().toLowerCase();
    var predicate = filterStatus && METRIC_FILTERS[filterStatus] ? METRIC_FILTERS[filterStatus] : null;
    return items.filter(function (item) {
      if (predicate) {
        if (!predicate(item)) return false;
      } else if (filterStatus && item.developmentStage !== filterStatus) {
        return false;
      }
      if (!keyword) return true;
      return (
        String(item.name || "").toLowerCase().indexOf(keyword) >= 0 ||
        String(item.sourceUrl || "").toLowerCase().indexOf(keyword) >= 0 ||
        String(item.sourcePlatform || "").toLowerCase().indexOf(keyword) >= 0
      );
    });
  }

  function renderTable() {
    var body = $("#sbTableBody", panel());
    if (!body) return;
    var items = visibleItems();
    if (!board) {
      body.innerHTML = '<tr><td colspan="9" class="profile-empty">加载中…</td></tr>';
      return;
    }
    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="9" class="profile-empty">' +
        (searchText || filterStatus ? "没有符合筛选条件的候选" : "还没有候选。上面填名称 / 来源 URL 就能加入第一条。") +
        "</td></tr>";
      return;
    }
    body.innerHTML = items
      .map(function (item) {
        var thumb = item.imageCount
          ? '<img class="board-thumb" src="' +
            esc(imgUrl(item.id, "images", item.images[0].name)) +
            '" alt="" loading="lazy" />'
          : '<span class="board-thumb board-thumb-empty">无图</span>';
        var next = item.nextAction && item.nextAction.label ? item.nextAction.label : "";
        return (
          '<tr data-sb-row="' + esc(item.id) + '">' +
          '<td class="col-seq">' + esc(item.seq || "") + "</td>" +
          '<td class="col-thumb">' + thumb + "</td>" +
          '<td class="col-product">' +
          '<button type="button" class="board-name-button" data-sb-open="' + esc(item.id) + '">' + esc(item.name) + "</button>" +
          (item.objectiveInfo
            ? '<span class="board-subline">' + esc(item.objectiveInfo.replace(/\s+/g, " ").slice(0, 46)) + "</span>"
            : '<span class="board-subline is-missing">客观信息未填</span>') +
          "</td>" +
          '<td class="col-source">' +
          (item.sourceUrl
            ? '<a href="' + esc(item.sourceUrl) + '" target="_blank" rel="noreferrer noopener">' + esc(item.sourcePlatform || "来源链接") + "</a>"
            : '<span class="is-missing">未填</span>') +
          "</td>" +
          '<td class="col-status">' +
          '<select class="board-status-select" data-sb-dev-stage="' + esc(item.id) + '">' +
          (board.statuses || [])
            .map(function (status) {
              return (
                '<option value="' + esc(status.id) + '"' + (status.id === item.developmentStage ? " selected" : "") + ">" + esc(status.label) + "</option>"
              );
            })
            .join("") +
          "</select>" +
          (item.dianxiaomiSyncStatus && item.dianxiaomiSyncStatus !== "NOT_STARTED"
            ? '<span class="board-sync-chip">店小秘 ' + esc(syncLabel(item.dianxiaomiSyncStatus)) + "</span>"
            : "") +
          (item.publishedStoreCount
            ? '<span class="board-sync-chip is-good">已发布 ' + esc(item.publishedStoreCount) + " 店</span>"
            : "") +
          (next ? '<span class="board-next">下一步：' + esc(next) + "</span>" : "") +
          "</td>" +
          '<td class="col-assets"><span class="board-chip">图 ' + esc(item.imageCount) + "</span>" +
          '<span class="board-chip' + (item.styleRefCount ? "" : " is-muted") + '">风格 ' + esc(item.styleRefCount) + "</span></td>" +
          '<td class="col-sku">' +
          (item.skuRowCount
            ? '<span class="board-chip is-good">' + esc(item.skuRowCount) + " 行</span>"
            : '<span class="is-missing">未抓取</span>') +
          "</td>" +
          '<td class="col-updated">' + esc(formatTime(item.updatedAt)) + "</td>" +
          '<td class="col-actions">' +
          '<button type="button" class="text-button" data-sb-open="' + esc(item.id) + '">详情</button>' +
          '<button type="button" class="text-button" data-sb-push="' + esc(item.id) + '"' + (item.imageCount ? "" : " disabled") + ">推送上品</button>" +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  /* ══ 新增候选 ══ */
  function createItem() {
    if (busy) return;
    var nameNode = $("#sbName", panel());
    var platformNode = $("#sbPlatform", panel());
    var urlNode = $("#sbSourceUrl", panel());
    var factsNode = $("#sbObjectiveInfo", panel());
    var urlsNode = $("#sbImageUrls", panel());
    var statusNode = $("#sbCreateStatus", panel());

    var name = nameNode ? nameNode.value.trim() : "";
    var sourceUrl = urlNode ? urlNode.value.trim() : "";
    if (!name && !sourceUrl) {
      notify(statusNode, "至少填产品名称或来源 URL", "is-error");
      return;
    }
    var imageUrls = (urlsNode ? urlsNode.value : "")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

    busy = true;
    notify(statusNode, "正在创建…");
    api("/items", {
      method: "POST",
      body: JSON.stringify({
        name: name,
        sourcePlatform: platformNode ? platformNode.value.trim() : "",
        sourceUrl: sourceUrl,
        objectiveInfo: factsNode ? factsNode.value : "",
        imageUrls: imageUrls
      })
    })
      .then(function (data) {
        var itemId = data.itemId;
        if (pendingCreateFiles.length) {
          notify(statusNode, "正在上传 " + pendingCreateFiles.length + " 张图…");
          return upload("/items/" + encodeURIComponent(itemId) + "/images", pendingCreateFiles).then(function () {
            return itemId;
          });
        }
        return itemId;
      })
      .then(function () {
        if (nameNode) nameNode.value = "";
        if (platformNode) platformNode.value = "";
        if (urlNode) urlNode.value = "";
        if (factsNode) factsNode.value = "";
        if (urlsNode) urlsNode.value = "";
        pendingCreateFiles = [];
        var hint = $("#sbCreateImagesHint", panel());
        if (hint) hint.textContent = "可选，也可加入后再补图";
        notify(statusNode, "已加入看板", "is-good");
        return load({ force: true });
      })
      .catch(function (error) {
        notify(statusNode, error.message, "is-error");
      })
      .then(function () {
        busy = false;
      });
  }

  /* ══ 详情弹窗 ══ */
  function findItem(id) {
    var items = (board && board.items) || [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function openDetail(id) {
    openItemId = id;
    renderDetail(id);
    var modal = $("#sbDetailModal", panel());
    if (modal) {
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    }
  }

  function closeDetail() {
    openItemId = null;
    var modal = $("#sbDetailModal", panel());
    if (modal) {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }
  }

  function imageGrid(item, kind, label, max) {
    var list = kind === "images" ? item.images : item.styleRefs;
    var cells = list
      .map(function (image) {
        return (
          '<figure class="board-asset">' +
          '<img src="' + esc(imgUrl(item.id, kind, image.name)) + '" alt="" loading="lazy" />' +
          '<button type="button" class="board-asset-remove" data-sb-remove-asset="' +
          esc(item.id) +
          '" data-sb-kind="' +
          kind +
          '" data-sb-name="' +
          esc(image.name) +
          '" title="删除">×</button>' +
          "</figure>"
        );
      })
      .join("");
    return (
      '<section class="board-detail-section">' +
      '<div class="board-section-head">' +
      "<h4>" + esc(label) + "（" + list.length + "/" + max + "）</h4>" +
      '<label class="text-button board-upload-button" for="sbUpload-' + kind + '">＋ 上传图片</label>' +
      '<input id="sbUpload-' + kind + '" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple hidden data-sb-upload="' +
      esc(item.id) +
      '" data-sb-kind="' +
      kind +
      '" />' +
      "</div>" +
      '<div class="board-asset-grid">' + (cells || '<span class="board-hint">还没有图片</span>') + "</div>" +
      "</section>"
    );
  }

  function syncLabel(id) {
    var list = (board && board.dianxiaomiSyncStatuses) || [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i].label;
    }
    return id;
  }

  /* ③ 逐店刊登：每条店铺一条独立记录，下拉只改本店，绝不影响其他店铺 */
  function renderStoreListings(item) {
    var listings = item.storeListings || [];
    var options = function (current) {
      return (board.storeListingStatuses || [])
        .map(function (status) {
          return (
            '<option value="' + esc(status.id) + '"' + (status.id === current ? " selected" : "") + ">" + esc(status.label) + "</option>"
          );
        })
        .join("");
    };
    var rows = listings
      .map(function (listing) {
        return (
          '<div class="board-store-row">' +
          '<span class="board-store-name">' +
          esc(listing.externalStoreCode || listing.storeId.slice(0, 8)) +
          "</span>" +
          '<select class="board-status-select" data-sb-store-listing="' + esc(item.id) + '" data-sb-store-id="' + esc(listing.storeId) + '">' +
          options(listing.status) +
          "</select>" +
          (listing.listingUrl
            ? '<a class="board-hint" href="' + esc(listing.listingUrl) + '" target="_blank" rel="noreferrer noopener">刊登链接</a>'
            : "") +
          (listing.failureReason ? '<span class="board-hint is-error">' + esc(listing.failureReason) + "</span>" : "") +
          "</div>"
        );
      })
      .join("");

    return (
      (listings.length
        ? '<div class="board-store-list">' + rows + "</div>"
        : '<p class="board-hint is-missing">尚未选择计划店铺。可以先制作 Listing；但创建正式发布任务前必须有已核验店铺。</p>') +
      '<div class="board-store-add">' +
      '<input type="text" data-sb-plan-store-input="' + esc(item.id) + '" placeholder="输入内部 store_id（UUID）添加计划店铺" spellcheck="false" />' +
      '<button type="button" class="text-button" data-sb-add-store="' + esc(item.id) + '">添加计划店铺</button>' +
      "</div>"
    );
  }

  function renderDetail(id) {
    var body = $("#sbDetailBody", panel());
    var item = findItem(id);
    if (!body) return;
    if (!item) {
      body.innerHTML = '<p class="profile-empty">条目已不存在</p>';
      return;
    }
    var skuPreview = "";
    if (item.skuTable && item.skuTable.rows && item.skuTable.rows.length) {
      var columns = item.skuTable.columns || [];
      var head = columns.length
        ? "<tr>" + columns.map(function (column) { return "<th>" + esc(column) + "</th>"; }).join("") + "</tr>"
        : "";
      var rows = item.skuTable.rows
        .slice(0, 8)
        .map(function (row) {
          return "<tr>" + row.map(function (cell) { return "<td>" + esc(cell) + "</td>"; }).join("") + "</tr>";
        })
        .join("");
      skuPreview =
        '<div class="board-sku-preview"><table>' + head + rows + "</table>" +
        (item.skuTable.rows.length > 8 ? '<p class="board-hint">仅显示前 8 行，共 ' + item.skuTable.rows.length + " 行</p>" : "") +
        "</div>";
    }

    var history = (item.history || [])
      .slice(-12)
      .reverse()
      .map(function (entry) {
        var text = entry.note || (entry.from ? entry.from + " → " + entry.to : entry.type);
        return '<li><span>' + esc(formatTime(entry.at)) + "</span>" + esc(text) + "</li>";
      })
      .join("");

    body.innerHTML =
      '<header class="board-modal-head">' +
      '<div><span class="mini-label">CANDIDATE</span><h3 id="sbDetailTitle">' + esc(item.name) + "</h3>" +
      '<p class="board-hint">创建 ' + esc(formatTime(item.createdAt)) + " · 更新 " + esc(formatTime(item.updatedAt)) + "</p></div>" +
      '<button type="button" class="text-button" data-sb-close="1">关闭</button>' +
      "</header>" +
      '<div class="board-status-block">' +
      '<span class="board-status-caption">① 产品开发阶段（Product 粒度）</span>' +
      '<div class="board-status-row">' +
      (board.statuses || [])
        .map(function (status) {
          return (
            '<button type="button" class="board-status-pill tone-' + esc(status.tone) + (status.id === item.developmentStage ? " active" : "") +
            '" data-sb-set-status="' + esc(item.id) + '" data-sb-to="' + esc(status.id) + '" title="' + esc(status.hint) + '">' +
            esc(status.label) + "</button>"
          );
        })
        .join("") +
      "</div>" +
      "</div>" +
      '<div class="board-status-block">' +
      '<span class="board-status-caption">② 店小秘同步状态（与平台刊登完全独立）</span>' +
      '<div class="board-status-row">' +
      (board.dianxiaomiSyncStatuses || [])
        .map(function (sync) {
          return (
            '<button type="button" class="board-status-pill tone-' + esc(sync.tone) + (sync.id === item.dianxiaomiSyncStatus ? " active" : "") +
            '" data-sb-set-sync="' + esc(item.id) + '" data-sb-to="' + esc(sync.id) + '">' +
            esc(sync.label) + "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<p class="board-hint">店小秘保存成功 ≠ 平台已发布。已存店小秘不会自动把任何店铺标成已发布。</p>' +
      "</div>" +
      '<div class="board-status-block">' +
      '<span class="board-status-caption">③ 逐店刊登状态（每店独立，互不覆盖）</span>' +
      renderStoreListings(item) +
      "</div>" +
      '<section class="board-detail-section board-form-grid">' +
      '<label>产品名称<input data-sb-field="name" value="' + esc(item.name) + '" /></label>' +
      '<label>来源平台<input data-sb-field="sourcePlatform" value="' + esc(item.sourcePlatform) + '" placeholder="1688 / AliExpress" /></label>' +
      '<label class="span2">来源 URL<input data-sb-field="sourceUrl" value="' + esc(item.sourceUrl) + '" spellcheck="false" /></label>' +
      '<label class="span2">客观信息<textarea data-sb-field="objectiveInfo" rows="4" spellcheck="false">' + esc(item.objectiveInfo) + "</textarea></label>" +
      '<label class="span2">备注<textarea data-sb-field="notes" rows="2" spellcheck="false">' + esc(item.notes) + "</textarea></label>" +
      '<div class="span2 row-actions">' +
      '<button type="button" class="button primary" data-sb-save="' + esc(item.id) + '">保存字段</button>' +
      '<span class="board-status" data-sb-save-status="' + esc(item.id) + '"></span>' +
      "</div>" +
      "</section>" +
      imageGrid(item, "images", "产品图", 12) +
      imageGrid(item, "style-refs", "参考生图风格（只借风格，不借产品）", 3) +
      '<section class="board-detail-section">' +
      "<h4>SKU 表（上品流程抓取后回填）</h4>" +
      '<p class="board-hint">把插件抓到的 SKU 表直接粘进来（支持从 Excel 复制的制表符分隔，或逗号分隔 CSV）。</p>' +
      '<textarea class="board-sku-input" data-sb-sku-input="' + esc(item.id) + '" rows="4" spellcheck="false" placeholder="SKU 名称	颜色	尺寸	价格"></textarea>' +
      '<div class="row-actions">' +
      '<button type="button" class="button secondary" data-sb-save-sku="' + esc(item.id) + '">保存 SKU 表</button>' +
      (item.skuRowCount ? '<button type="button" class="text-button" data-sb-clear-sku="' + esc(item.id) + '">清空</button>' : "") +
      '<span class="board-status" data-sb-sku-status="' + esc(item.id) + '"></span>' +
      "</div>" +
      skuPreview +
      "</section>" +
      '<section class="board-detail-section board-detail-danger">' +
      "<h4>动作</h4>" +
      '<div class="row-actions">' +
      '<button type="button" class="button primary" data-sb-push="' + esc(item.id) + '"' + (item.imageCount ? "" : " disabled") + ">推送到上品流程（替换当前产品素材）</button>" +
      '<button type="button" class="button danger" data-sb-delete="' + esc(item.id) + '">删除候选</button>' +
      "</div>" +
      '<p class="board-hint">推送会先清空 当前产品/产品图 与 风格参考图，再写入本候选素材，然后跳到上品工作台继续 Listing 制作。流程运行中不允许推送。</p>' +
      "</section>" +
      '<section class="board-detail-section"><h4>操作历史</h4><ul class="board-history">' + (history || "<li>暂无记录</li>") + "</ul></section>";
  }

  /* ══ 动作 ══ */
  function saveFields(id) {
    var body = $("#sbDetailBody", panel());
    if (!body) return;
    var payload = {};
    $$("[data-sb-field]", body).forEach(function (input) {
      payload[input.dataset.sbField] = input.value;
    });
    var status = $('[data-sb-save-status="' + id + '"]', body);
    notify(status, "保存中…");
    api("/items/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(payload) })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        notify(status, "已保存", "is-good");
        renderAll();
        renderDetail(id);
      })
      .catch(function (error) {
        notify(status, error.message, "is-error");
      });
  }

  /* 三个独立状态写入口：互不覆盖（基线 §03.6） */
  function applyBoardUpdate(id, data) {
    board = data;
    fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
    renderAll();
    if (openItemId === id) renderDetail(id);
  }

  function setDevelopmentStage(id, stage) {
    api("/items/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ developmentStage: stage })
    })
      .then(function (data) {
        applyBoardUpdate(id, data);
      })
      .catch(function (error) {
        window.alert("开发阶段切换失败：" + error.message);
      });
  }

  function setSyncStatus(id, syncStatus) {
    api("/items/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ dianxiaomiSyncStatus: syncStatus })
    })
      .then(function (data) {
        applyBoardUpdate(id, data);
      })
      .catch(function (error) {
        window.alert("店小秘同步状态切换失败：" + error.message);
      });
  }

  function setStoreListingStatus(id, storeId, status) {
    api("/items/" + encodeURIComponent(id) + "/store-listings", {
      method: "PATCH",
      body: JSON.stringify({ storeId: storeId, status: status })
    })
      .then(function (data) {
        applyBoardUpdate(id, data);
      })
      .catch(function (error) {
        window.alert("店铺刊登状态切换失败：" + error.message);
      });
  }

  function saveSku(id) {
    var body = $("#sbDetailBody", panel());
    if (!body) return;
    var input = $('[data-sb-sku-input="' + id + '"]', body);
    var status = $('[data-sb-sku-status="' + id + '"]', body);
    var text = input ? input.value : "";
    if (!text.trim()) {
      notify(status, "先粘贴 SKU 表内容", "is-error");
      return;
    }
    notify(status, "保存中…");
    api("/items/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ skuTable: { text: text, source: "manual-paste" } })
    })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        renderAll();
        renderDetail(id);
      })
      .catch(function (error) {
        notify(status, error.message, "is-error");
      });
  }

  function clearSku(id) {
    api("/items/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ skuTable: null }) })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        renderAll();
        renderDetail(id);
      })
      .catch(function (error) {
        window.alert("清空失败：" + error.message);
      });
  }

  function pushItem(id) {
    var item = findItem(id);
    if (!item) return;
    var ok = window.confirm(
      "推送上品会先清空「当前产品/产品图」与「风格参考图」，再写入该候选的素材。\n\n候选：" +
        item.name +
        "\n产品图：" + item.imageCount + " 张\n参考风格图：" + item.styleRefCount + " 张\n\n确定推送吗？"
    );
    if (!ok) return;
    api("/items/" + encodeURIComponent(id) + "/push-to-listing", { method: "POST", body: "{}" })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        renderAll();
        var message = $("#sbBoardMessage", panel());
        if (message) {
          message.classList.remove("is-error");
          message.textContent = "已推送「" + item.name + "」：产品图 " + data.imageCount + " 张，风格图 " + ((data.listing && data.listing.styleRefCount) || 0) + " 张。已切到上品工作台。";
        }
        closeDetail();
        if (typeof window.__ykSwitchView === "function") {
          window.__ykSwitchView("materials");
        }
      })
      .catch(function (error) {
        window.alert("推送失败：" + error.message);
      });
  }

  function deleteItem(id) {
    var item = findItem(id);
    if (!item) return;
    if (!window.confirm("删除候选「" + item.name + "」及其图片？此操作不可撤销。")) return;
    api("/items/" + encodeURIComponent(id) + "?purge=1", { method: "DELETE" })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        closeDetail();
        renderAll();
      })
      .catch(function (error) {
        window.alert("删除失败：" + error.message);
      });
  }

  function removeAsset(id, kind, name) {
    if (!window.confirm("删除这张图片？")) return;
    var path = "/items/" + encodeURIComponent(id) + "/" + kind + "/" + encodeURIComponent(name);
    api(path, { method: "DELETE" })
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        renderAll();
        renderDetail(id);
      })
      .catch(function (error) {
        window.alert("删除失败：" + error.message);
      });
  }

  function handleAssetUpload(input) {
    var id = input.dataset.sbUpload;
    var kind = input.dataset.sbKind;
    if (!input.files || !input.files.length) return;
    var path = "/items/" + encodeURIComponent(id) + (kind === "style-refs" ? "/style-refs" : "/images");
    upload(path, input.files)
      .then(function (data) {
        board = data;
        fingerprint = JSON.stringify(data.items || []) + "|" + JSON.stringify(data.counts || {});
        renderAll();
        renderDetail(id);
      })
      .catch(function (error) {
        window.alert("上传失败：" + error.message);
      })
      .then(function () {
        input.value = "";
      });
  }

  /* ══ 事件绑定（事件委托，一次绑定覆盖动态内容）══ */
  function bind() {
    var node = panel();
    if (!node) return;

    node.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var close = target.closest("[data-sb-close]");
      if (close) {
        closeDetail();
        return;
      }
      var open = target.closest("[data-sb-open]");
      if (open) {
        openDetail(open.dataset.sbOpen);
        return;
      }
      var push = target.closest("[data-sb-push]");
      if (push) {
        pushItem(push.dataset.sbPush);
        return;
      }
      var save = target.closest("[data-sb-save]");
      if (save) {
        saveFields(save.dataset.sbSave);
        return;
      }
      var saveSkuButton = target.closest("[data-sb-save-sku]");
      if (saveSkuButton) {
        saveSku(saveSkuButton.dataset.sbSaveSku);
        return;
      }
      var clearSkuButton = target.closest("[data-sb-clear-sku]");
      if (clearSkuButton) {
        clearSku(clearSkuButton.dataset.sbClearSku);
        return;
      }
      var setStatusButton = target.closest("[data-sb-set-status]");
      if (setStatusButton) {
        setDevelopmentStage(setStatusButton.dataset.sbSetStatus, setStatusButton.dataset.sbTo);
        return;
      }
      var setSyncButton = target.closest("[data-sb-set-sync]");
      if (setSyncButton) {
        setSyncStatus(setSyncButton.dataset.sbSetSync, setSyncButton.dataset.sbTo);
        return;
      }
      var addStore = target.closest("[data-sb-add-store]");
      if (addStore) {
        var itemId = addStore.dataset.sbAddStore;
        var input = $('[data-sb-plan-store-input="' + itemId + '"]', panel());
        var storeId = input ? String(input.value || "").trim() : "";
        if (!storeId) {
          window.alert("请填写内部 store_id（UUID）。外部编号 400370 不是内部主键，不能填在这里。");
          return;
        }
        setStoreListingStatus(itemId, storeId, "PLANNED");
        if (input) input.value = "";
        return;
      }
      var del = target.closest("[data-sb-delete]");
      if (del) {
        deleteItem(del.dataset.sbDelete);
        return;
      }
      var remove = target.closest("[data-sb-remove-asset]");
      if (remove) {
        removeAsset(remove.dataset.sbRemoveAsset, remove.dataset.sbKind, remove.dataset.sbName);
        return;
      }
      var metric = target.closest("[data-sb-filter]");
      if (metric) {
        filterStatus = metric.dataset.sbFilter || "";
        var select = $("#sbStatusFilter", node);
        if (select) select.value = filterStatus;
        renderMetrics();
        renderTable();
        return;
      }
      if (target.id === "sbCreateButton") {
        createItem();
        return;
      }
      if (target.id === "sbRefreshButton") {
        load({ force: true });
        return;
      }
      if (target.id === "sbToggleCreate") {
        var body = $("#sbCreateBody", node);
        if (body) {
          var hidden = body.classList.toggle("hidden");
          target.textContent = hidden ? "展开" : "收起";
        }
      }
    });

    node.addEventListener("change", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      if (target.id === "sbStatusFilter") {
        filterStatus = target.value || "";
        renderMetrics();
        renderTable();
        return;
      }
      var statusSelect = target.closest("[data-sb-dev-stage]");
      if (statusSelect) {
        setDevelopmentStage(statusSelect.dataset.sbDevStage, statusSelect.value);
        return;
      }
      var syncSelect = target.closest("[data-sb-sync-status]");
      if (syncSelect) {
        setSyncStatus(syncSelect.dataset.sbSyncStatus, syncSelect.value);
        return;
      }
      var storeSelect = target.closest("[data-sb-store-listing]");
      if (storeSelect) {
        setStoreListingStatus(storeSelect.dataset.sbStoreListing, storeSelect.dataset.sbStoreId, storeSelect.value);
        return;
      }
      if (target.id === "sbCreateImages") {
        pendingCreateFiles = Array.prototype.slice.call(target.files || []);
        var hint = $("#sbCreateImagesHint", node);
        if (hint) {
          hint.textContent = pendingCreateFiles.length
            ? "已选 " + pendingCreateFiles.length + " 张，加入看板时一起上传"
            : "可选，也可加入后再补图";
        }
        return;
      }
      var uploadInput = target.closest("[data-sb-upload]");
      if (uploadInput) handleAssetUpload(uploadInput);
    });

    node.addEventListener("input", function (event) {
      if (event.target && event.target.id === "sbSearch") {
        searchText = event.target.value || "";
        renderTable();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && openItemId) closeDetail();
    });
  }

  /* ══ 轮询：只在看板可见时请求 ══ */
  function startPolling() {
    window.setInterval(function () {
      if (document.hidden) return;
      if (!panelVisible()) return;
      if (openItemId) return; /* 详情弹窗打开时暂停自动刷新，避免打断编辑 */
      if (busy) return;
      load();
    }, POLL_MS);
  }

  function init() {
    if (!panel()) return;
    bind();
    load({ force: true });
    startPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
