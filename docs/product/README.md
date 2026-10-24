# Product documentation reconciliation
Date: 2026-10-24 (Asia/Shanghai)

## Verified source-level findings
The public main tree inspected for this review is 3cb10997db4fd286738af3faa318a0fec5a8a494.
It contains Web implementation in flutter_app/lib/services/web_contract_player.dart, its audio/platform adapters, and docs/testing/web-playback-reliability.md.
The exact docs/product/playback-behavior-contract.md path and document were absent from that tree.
Therefore the finding is a missing formal specification, not proof that the entire Web implementation was omitted. Full old/public source parity and current production-deployed SHA were not audited in this task.

## Restored baseline
playback-behavior-contract.md is an unchanged copy of EP-PBC-001 v1.4 from the archived original repository:
https://github.com/gehbfarr5/englishpod-trancy-player/blob/main/docs/product/playback-behavior-contract.md
Source content blob SHA: 39a0ac3d702b65209d21215411f783240461e412.
Original dates, repository references, historical execution permissions and acceptance claims are preserved for provenance; they do not grant new execution permissions or establish current deployment status.
The original includes dual-audio rules. For the proposed new Mini Program scope, review the explicit differences in miniprogram-v1-product-spec-draft.md. Other platforms are unchanged.

## Reading order
1. miniprogram-v1-product-spec-draft.md — proposed Mini Program scope; distinguishes user-confirmed decisions from suggestions and pending validation.
2. playback-behavior-contract.md — preserved behavior baseline, especially progress and completion semantics.
3. miniprogram-platform-evidence.md — M0 evidence register; official page bodies remain unverified where automated retrieval failed.

## Remaining audit boundaries
- Identify other missing non-sensitive Web/product documentation through a dedicated old/public inventory before declaring all migration documentation complete.
- Reconcile stale README/resource-register migration status against newer evidence in a separate scoped change; this review does not assert current cloud or deployment health.
- Verify official documentation, then run focused physical-device experiments. No app implementation, deployment or user data was changed here.
