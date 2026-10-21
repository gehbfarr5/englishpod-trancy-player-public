/**
 * 云函数：getLessonDetail
 *
 * 职责：按 `lessonId` 从云存储读取 `lessons/{lessonId}.json.gz`，gunzip 解压后返回单课详情 JSON。
 *
 * 入参：
 *   - lessonId {string} 必填，课程 ID（4 位零填充，如 "0001"）
 *   - fileID   {string} 可选，直接指定云存储 fileID（用于调试/跳过索引查询）
 *
 * 返回（统一信封）：
 *   { success: true,  data: <LessonDetail>, error: null }
 *   { success: false, data: null, error: { code, message } }
 *
 * 实现说明：
 *   - 云存储 fileID 无法凭路径直接推断，因此先从 `lessons_index` 集合读取该课的
 *     `json_file_id` 字段（由 pipeline/upload_to_cloudbase.py 在上传时写入），
 *     再用 `cloud.downloadFile({ fileID })` 下载。
 *   - 解压用内置 `zlib.gunzipSync`；若内容本身未压缩，则回退为按 utf8 直接解析。
 */

const cloud = require('wx-server-sdk');
const zlib = require('zlib');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'lessons_index';

/** 成功返回。 */
function ok(data) {
  return { success: true, data, error: null };
}

/** 失败返回。 */
function fail(code, message) {
  return { success: false, data: null, error: { code, message } };
}

/**
 * 从索引集合读取单课文档，兼容 `lesson_id` 与 `LessonId` 两种键名。
 * @param {string} lessonId
 * @returns {Promise<object|null>}
 */
async function findIndexDoc(lessonId) {
  const snake = await db
    .collection(COLLECTION)
    .where({ lesson_id: lessonId })
    .limit(1)
    .get();
  if (snake.data && snake.data.length > 0) {
    return snake.data[0];
  }

  const camel = await db
    .collection(COLLECTION)
    .where({ LessonId: lessonId })
    .limit(1)
    .get();
  if (camel.data && camel.data.length > 0) {
    return camel.data[0];
  }

  return null;
}

exports.main = async (event) => {
  try {
    const lessonId =
      event && typeof event.lessonId === 'string' ? event.lessonId.trim() : '';
    if (!lessonId) {
      return fail('INVALID_PARAM', 'lessonId 不能为空');
    }

    // 1) 定位云存储 fileID
    let fileID = event && typeof event.fileID === 'string' ? event.fileID.trim() : '';
    if (!fileID) {
      const doc = await findIndexDoc(lessonId);
      if (!doc) {
        return fail('NOT_FOUND', `未找到课程 ${lessonId} 的索引记录`);
      }
      fileID = doc.json_file_id;
    }
    if (!fileID) {
      return fail('NO_FILE_ID', `课程 ${lessonId} 的索引缺少 json_file_id 字段`);
    }

    // 2) 下载并解压
    const download = await cloud.downloadFile({ fileID });
    const content = download ? download.fileContent : null;
    if (!content) {
      return fail('DOWNLOAD_FAILED', `下载云存储文件失败：${fileID}`);
    }

    let jsonText;
    try {
      jsonText = zlib.gunzipSync(content).toString('utf8');
    } catch (gzErr) {
      // 内容可能未 gzip，退化为直接按 utf8 读取。
      jsonText = content.toString('utf8');
    }

    const lesson = JSON.parse(jsonText);
    return ok(lesson);
  } catch (err) {
    console.error('[getLessonDetail] 处理失败：', err);
    return fail('INTERNAL_ERROR', err && err.message ? err.message : String(err));
  }
};
