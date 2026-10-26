import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ENTITLEMENT_STORAGE_KEY,
  EntitlementService,
} from './entitlementService';
import { createMemoryKeyValue } from '../test-support/memoryKeyValue';

describe('EntitlementService · 权益读取与持久化', () => {
  test('初始无记录时默认非 VIP，Lesson 1~10 解锁，Lesson 11 锁定', () => {
    const kv = createMemoryKeyValue();
    const service = new EntitlementService(kv);

    assert.equal(service.isVip(), false);
    assert.equal(service.isLessonUnlocked('0001'), true);
    assert.equal(service.isLessonUnlocked('0010'), true);
    assert.equal(service.isLessonUnlocked('0011'), false);
    assert.equal(service.isLessonUnlocked('0335'), false);
  });

  test('设置 VIP 后落盘并持久生效，所有课程均解锁', () => {
    const kv = createMemoryKeyValue();
    const service = new EntitlementService(kv);

    service.setEntitlement({ isVip: true, orderId: 'test_order_123' });
    assert.equal(service.isVip(), true);
    assert.equal(service.isLessonUnlocked('0011'), true);
    assert.equal(service.isLessonUnlocked('0335'), true);

    const saved = kv.data.get(ENTITLEMENT_STORAGE_KEY);
    assert.ok(typeof saved === 'string');
    assert.ok(saved.includes('"isVip":true'));

    // 重启后从存储恢复
    const restoredService = new EntitlementService(kv);
    assert.equal(restoredService.isVip(), true);
    assert.equal(restoredService.getEntitlement().orderId, 'test_order_123');
    assert.equal(restoredService.isLessonUnlocked('0011'), true);
  });

  test('订阅 VIP 变更事件只在 isVip 变化时触发', () => {
    const kv = createMemoryKeyValue();
    const service = new EntitlementService(kv);

    let notifyCount = 0;
    let lastVipState = false;
    const unsubscribe = service.subscribe((isVip) => {
      notifyCount++;
      lastVipState = isVip;
    });

    service.setEntitlement({ isVip: false }); // 状态未变，不触发
    assert.equal(notifyCount, 0);

    service.setEntitlement({ isVip: true }); // 变为 true，触发
    assert.equal(notifyCount, 1);
    assert.equal(lastVipState, true);

    unsubscribe();
    service.setEntitlement({ isVip: false }); // 取消订阅后不再触发
    assert.equal(notifyCount, 1);
  });
});
