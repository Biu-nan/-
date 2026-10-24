import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { CharmListingWorkspaceService } from "../src/charm-listing-workspace-service.js";

async function withService(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "charm-listing-"));
  const service = new CharmListingWorkspaceService({ dbPath: path.join(dir, "workspace.sqlite") });
  try { return await run(service); }
  finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
}

describe("CharmListingWorkspaceService", () => {
  it("blocks incomplete product facts before generating a listing", async () => withService(async (service) => {
    const [job] = await service.createProducts([{ productName: "Plush cat charm", subtype: "plush" }]);
    assert.equal(job.status, "NEEDS_INPUT");
    assert.deepEqual(job.checkpoint.validation.missing, ["material", "packageContents", "attachmentType"]);
    const afterRun = await service.run(job.id);
    assert.equal(afterRun.status, "NEEDS_INPUT");
  }));

  it("creates a reviewable draft and requires an approval token before publishing", async () => withService(async (service) => {
    const [created] = await service.createProducts([{
      productName: "Silver star bag charm", subtype: "metal", material: "Zinc Alloy",
      packageContents: "1 bag charm", attachmentType: "Lobster clasp", colors: "Silver"
    }]);
    const review = await service.run(created.id);
    assert.equal(review.status, "REVIEW_REQUIRED");
    assert.ok(review.draft?.content.selectedTitle);
    await assert.rejects(() => service.requestPublish(created.id, "invalid"), /人工审核/);
    const approved = await service.approve(created.id, "lance");
    assert.equal(approved.status, "APPROVED");
    const publishing = await service.requestPublish(created.id, approved.approval.token);
    assert.equal(publishing.status, "PUBLISHING");
    assert.equal(publishing.publishAttempt.status, "PENDING_OPERATOR");
  }));

  it("keeps publish idempotent and marks an incomplete receipt as drift", async () => withService(async (service) => {
    const [created] = await service.createProducts([{
      productName: "Acrylic rainbow charm", subtype: "acrylic", material: "Acrylic",
      packageContents: "1 charm", attachmentType: "Key ring"
    }]);
    await service.run(created.id);
    const approved = await service.approve(created.id, "lance");
    const first = await service.requestPublish(created.id, approved.approval.token);
    const second = await service.requestPublish(created.id, approved.approval.token);
    assert.equal(first.publishAttempt.idempotencyKey, second.publishAttempt.idempotencyKey);
    const drift = await service.recordPublishReceipt(created.id, { screenshot: "draft.png" });
    assert.equal(drift.status, "DRIFT");
  }));
});
