import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ceoContentHash, ceoContextId } from './ceo-operating-context.js';
import { validateCeoDecision } from './ceo-decision-contract.js';
import { buildDailyPlan } from './ceo-daily-plan.js';
import {replanErrorCodes} from './ceo-review-replanning.js';

function fail(code) { const e = new Error(code); e.code = code; throw e; }
const domainCodes = new Set(['CONTEXT_CHANGED','INVALID_CONTEXT','INVALID_DECISION','GOAL_VERSION_CONFLICT','DECISION_VERSION_CONFLICT','DECISION_CONTEXT_CONFLICT','PLAN_VERSION_CONFLICT','REVIEW_SOURCE_CHANGED','REVIEW_SOURCE_UNAVAILABLE',...replanErrorCodes]);
const entryId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v);
export function ceoDraftEntryHash({entryRequest,expectedContextId,decision,candidates,requestBinding}){
 if(!entryRequest||Object.keys(entryRequest).length!==3||!entryId(entryRequest.requestId)||typeof entryRequest.conversationRef!=='string'||!entryRequest.conversationRef.trim()||entryRequest.conversationRef.length>240||typeof entryRequest.actorId!=='string'||!entryRequest.actorId.trim()||entryRequest.actorId.length>120)fail('INVALID_INPUT');
 return ceoContentHash({entryRequest,expectedContextId,decision,candidates,...(requestBinding?{requestBinding}:{})});
}

// Only the trusted local host supplies contexts; this is not a remotely exposed authentication boundary.
export class CeoDraftWorkspace {
  constructor({dbPath} = {}) {
    if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) fail('INVALID_DB_PATH');
    this.dbPath = dbPath; this.db = null;
  }
  ready() {
    if (this.db) return;
    try {
      mkdirSync(path.dirname(this.dbPath),{recursive:true});
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS ceo_goal_versions (
          goal_id TEXT NOT NULL, version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL, PRIMARY KEY(goal_id,version));
        CREATE TABLE IF NOT EXISTS ceo_context_snapshots (
          context_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, goal_version INTEGER NOT NULL,
          payload_json TEXT NOT NULL, FOREIGN KEY(goal_id,goal_version) REFERENCES ceo_goal_versions(goal_id,version));
        CREATE TABLE IF NOT EXISTS ceo_decision_versions (
          decision_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL, FOREIGN KEY(context_id) REFERENCES ceo_context_snapshots(context_id));
        CREATE TABLE IF NOT EXISTS ceo_plan_versions (
          plan_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, decision_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, candidates_json TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(context_id) REFERENCES ceo_context_snapshots(context_id),
          FOREIGN KEY(decision_id) REFERENCES ceo_decision_versions(decision_id));
        CREATE TABLE IF NOT EXISTS ceo_entry_draft_requests (
          request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result_json TEXT NOT NULL);`);
    } catch { this.close(); fail('STORAGE_FAILED'); }
  }
  close() { this.db?.close(); this.db = null; }
  getPlan(planId) {
    this.ready();
    try { const r=this.db.prepare('SELECT payload_json FROM ceo_plan_versions WHERE plan_id=?').get(planId); return r ? JSON.parse(r.payload_json) : null; }
    catch { fail('STORAGE_FAILED'); }
  }
  getDraftRequest(requestId) {
    if (!entryId(requestId)) fail('INVALID_INPUT');
    this.ready();
    try { const row=this.db.prepare('SELECT result_json FROM ceo_entry_draft_requests WHERE request_id=?').get(requestId); return row ? JSON.parse(row.result_json) : null; }
    catch { fail('STORAGE_FAILED'); }
  }
  saveDraft({context,decision,candidates,expectedContextId,now=new Date(),entryRequest,requestBinding,finalizeDraft,existingDependencies=[]}) {
    let entryHash;
    const replay = () => {
      const row=this.db.prepare('SELECT request_hash,result_json FROM ceo_entry_draft_requests WHERE request_id=?').get(entryRequest.requestId);
      if (!row) return null;
      if (row.request_hash!==entryHash) fail('OPERATION_CONFLICT');
      return {...JSON.parse(row.result_json),replayed:true};
    };
    if (entryRequest !== undefined) {
      entryHash=ceoDraftEntryHash({entryRequest,expectedContextId,decision,candidates,requestBinding});
      this.ready();
      const previous=replay();if(previous)return previous;
    }
    if (context?.schema !== 'ceo-operating-context/v1' || !Array.isArray(context.facts) || context.facts.length
      || !Array.isArray(context.observations) || !Array.isArray(context.sourceManifest)
      || !context.goal || !context.dictionaryHash || context.contextId !== ceoContextId(context)) fail('INVALID_CONTEXT');
    if (context.contextId !== expectedContextId) fail('CONTEXT_CHANGED');
    const validation=validateCeoDecision(decision,{goal:context.goal,facts:context.facts,now});
    if (['INVALID','NEEDS_CONFIRMATION'].includes(validation.readiness)) fail('INVALID_DECISION');
    let plan;
    try { plan=buildDailyPlan({goal:context.goal,facts:context.facts,decision,candidates,now,existingDependencies,contextId:context.contextId}); }
    catch { fail('INVALID_DECISION'); }
    const goal=context.goal,goalHash=ceoContentHash(goal),decisionHash=ceoContentHash(decision),planHash=ceoContentHash(plan);
    this.ready();
    let transaction=false;
    try {
      this.db.exec('BEGIN IMMEDIATE');transaction=true;
      if (entryRequest) {
        const previous=replay();
        if(previous){this.db.exec('COMMIT');transaction=false;return previous;}
      }
      const oldGoal=this.db.prepare('SELECT payload_hash FROM ceo_goal_versions WHERE goal_id=? AND version=?').get(goal.goalId,goal.version);
      if (oldGoal && oldGoal.payload_hash!==goalHash) fail('GOAL_VERSION_CONFLICT');
      this.db.prepare('INSERT OR IGNORE INTO ceo_goal_versions VALUES(?,?,?,?)').run(goal.goalId,goal.version,goalHash,JSON.stringify(goal));
      this.db.prepare('INSERT OR IGNORE INTO ceo_context_snapshots VALUES(?,?,?,?)').run(context.contextId,goal.goalId,goal.version,JSON.stringify(context));
      const oldDecision=this.db.prepare('SELECT payload_hash,context_id FROM ceo_decision_versions WHERE decision_id=?').get(decision.decisionId);
      if (oldDecision && oldDecision.payload_hash!==decisionHash) fail('DECISION_VERSION_CONFLICT');
      if (oldDecision && oldDecision.context_id!==context.contextId) fail('DECISION_CONTEXT_CONFLICT');
      this.db.prepare('INSERT OR IGNORE INTO ceo_decision_versions VALUES(?,?,?,?)').run(decision.decisionId,context.contextId,decisionHash,JSON.stringify(decision));
      const oldPlan=this.db.prepare('SELECT payload_hash,context_id FROM ceo_plan_versions WHERE plan_id=?').get(plan.planId);
      if (oldPlan && (oldPlan.payload_hash!==planHash || oldPlan.context_id!==context.contextId)) fail('PLAN_VERSION_CONFLICT');
      if (!oldPlan) this.db.prepare('INSERT INTO ceo_plan_versions VALUES(?,?,?,?,?,?,?)').run(plan.planId,context.contextId,decision.decisionId,planHash,JSON.stringify(plan),JSON.stringify(candidates),now.toISOString());
      let result={schema:'ceo-draft-receipt/v1',contextId:context.contextId,planId:plan.planId,status:'DRAFT',commitment:plan.commitment,created:!oldPlan,plan,
        ...(entryRequest?{entry:entryRequest,externalExecution:false,replayed:false}:{})};
      if(finalizeDraft)result=finalizeDraft(result);
      if(entryRequest)this.db.prepare('INSERT INTO ceo_entry_draft_requests VALUES(?,?,?)').run(entryRequest.requestId,entryHash,JSON.stringify(result));
      this.db.exec('COMMIT');transaction=false;
      return result;
    } catch (e) {
      if (transaction) { try { this.db.exec('ROLLBACK'); } catch { /* Keep original failure; no success receipt. */ } }
      if (domainCodes.has(e.code) || e.code==='OPERATION_CONFLICT') throw e;
      fail('STORAGE_FAILED');
    }
  }
}
