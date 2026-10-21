/**
 * 云函数：getLessonIndex
 *
 * 职责：从云数据库集合 `lessons_index` 读取课程库轻量索引（335 条）并返回。
 *
 * 入参（均可选）：
 *   - limit  {number} 返回条数上限，默认 335（即全量）
 *   - offset {number} 跳过条数，默认 0
 *
 * 返回（统一信封）：
 *   { success: true,  data: { items, total, limit, offset }, error: null }
 *   { success: false, data: null, error: { code, message } }
 *
 * 说明：
 *   - 云函数中单次 `db.get()` 上限为 100 条，这里用 skip/limit 循环内部分页，
 *     对调用方表现为「一次拿到全部」。
 *   - 索引文档中可携带 `file_ids: { dg, pb }`（由 pipeline/upload_to_cloudbase.py 写入），
 *     小程序端据此解析音频 fileID；不携带也不影响本函数正常工作。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'lessons_index';
/** 云函数单次查询上限。 */
const BATCH_SIZE = 100;
/** 默认返回全量索引。 */
const DEFAULT_LIMIT = 335;

/** 成功返回。 */
function ok(data) {
  return { success: true, data, error: null };
}

/** 失败返回。 */
function fail(code, message) {
  return { success: false, data: null, error: { code, message } };
}

/**
 * 按 limit/offset 拉取索引，内部按 BATCH_SIZE 分页。
 * @param {number} limit 需要的总条数
 * @param {number} offset 起始偏移
 * @returns {Promise<object[]>}
 */
async function fetchIndex(limit, offset) {
  const collection = db.collection(COLLECTION);
  const items = [];
  let remaining = limit;
  let skip = offset;

  while (remaining > 0) {
    const batch = Math.min(BATCH_SIZE, remaining);
    const res = await collection.skip(skip).limit(batch).get();
    const list = res.data || [];
    for (const doc of list) {
      items.push(doc);
    }
    if (list.length < batch) {
      break;
    }
    skip += list.length;
    remaining -= list.length;
  }

  // 稳定排序，保证前端列表顺序与课程编号一致。
  items.sort((a, b) => (a.lesson_number || 0) - (b.lesson_number || 0));
  return items;
}

exports.main = async (event) => {
  try {
    const rawLimit = event ? event.limit : undefined;
    const rawOffset = event ? event.offset : undefined;

    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT;
    const offset =
      Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const countRes = await db.collection(COLLECTION).count();
    const total = countRes.total || 0;

    const items = await fetchIndex(limit, offset);

    return ok({ items, total, limit, offset });
  } catch (err) {
    console.error('[getLessonIndex] 查询失败：', err);
    return fail('QUERY_FAILED', err && err.message ? err.message : String(err));
  }
};
