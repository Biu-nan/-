import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDianxiaomiProfile } from "../src/config.js";

describe("箱包配件上架前置配置", () => {
    it("uses the live Choice stocking-type label", () => {
        const profile = getDianxiaomiProfile("xiangBao");
        assert.equal(profile.fixed.stockType, "国内履约");
    });
});
