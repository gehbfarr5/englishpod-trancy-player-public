/**
 * WeChat Mini Program Cloud Testing (小程序云测 / MiniTest) Integration Hook.
 *
 * Facilitates automated cloud testing on Tencent real device matrices.
 * When MINITEST_TOKEN is provided, triggers the configured cloud test plan
 * and retrieves device reports. When absent, gracefully skips with setup instructions.
 */
import { writeSync } from 'node:fs';

function note(msg) {
  try {
    writeSync(2, `[wechat-minitest] ${msg}\n`);
  } catch {
    console.error(`[wechat-minitest] ${msg}`);
  }
}

async function main() {
  const token = process.env.MINITEST_TOKEN;
  const planId = process.env.MINITEST_PLAN_ID;
  const userVersion = process.env.MINITEST_VERSION;

  if (!token || !planId) {
    console.log('[wechat-minitest] Cloud testing credentials not configured. Skipping MiniTest run.');
    console.log('[wechat-minitest] Refer to docs/wechat-cloud-testing.md to enable automated real-device cloud tests.');
    process.exit(0);
  }

  note(`Initiating MiniTest plan=${planId} version=${userVersion || 'latest'}`);

  try {
    const res = await fetch('https://minitest.weixin.qq.com/thirdapi/plan/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        user_version: userVersion,
      }),
    });

    if (!res.ok) {
      note(`MiniTest API HTTP error ${res.status}`);
      process.exit(1);
    }

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      note(`MiniTest API returned error code ${data.errcode}: ${data.errmsg || 'unknown error'}`);
      process.exit(1);
    }

    console.log('[wechat-minitest] MiniTest plan successfully triggered:', data);
    process.exit(0);
  } catch (err) {
    note(`Failed to reach MiniTest API: ${err?.message || 'unknown error'}`);
    process.exit(1);
  }
}

main();
