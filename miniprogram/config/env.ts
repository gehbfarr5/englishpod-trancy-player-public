/**
 * 小程序 CloudBase 与行为开关集中配置。
 * 当前 AppID、CloudBase 环境 ID、fileID 前缀均已填写，不是占位符。
 * 云端实际归属、主体与费用需参考平台/账号迁移核对记录；不要在此填入密钥。
 * core/ 不可引用 wx.*；所有时间单位采用秒（updatedAtMs 除外）。
 */

/** 微信云开发环境 ID。 */
export const CLOUD_ENV_ID: string = 'dev-englishpod-d6ghydrutca03de08';

/** 小程序 AppID：已配置；必须与 project.config.json 中的 appid 保持一致。 */
export const APP_ID: string = 'wxf9bd7099653c6159';

/**
 * App 展示名称。
 *
 * 当前 UI 展示值为 `EnglishPod`；项目产品称呼曾使用 `EnglishPod 精听`，
 * 播放器页标题等应引用本常量。微信公众平台正式登记名称需另行核实。
 *
 * 命名依据：小程序服务类目为「工具 → 信息查询」，故名称避开
 * 「电台 / FM / 播客 / 有声书 / 音频节目 / 课程平台」等易触发类目复核的措辞。
 */
export const APP_DISPLAY_NAME: string = 'EnglishPod';

/**
 * ⚠️⚠️⚠️ 开发用 Mock 数据开关（上线前必须置为 false）⚠️⚠️⚠️
 *
 * 历史背景（目前云环境已部署且已配置 AppID）：早期在云函数尚未部署时，
 *       使用 Mock 可供离线预览；目前默认 false，走真实 CloudBase。
 *
 * 取值语义：
 *   - `true`  ：课程库页从 `mock/lessonIndex.ts`（第 1–30 课轻量索引）读取，**完全离线**；
 *   - `false` ：走真实链路（`adapters/wechat/cloud.ts` → 云函数 / 云数据库）。
 *
 * 🚨 上线前必做：
 *   1. 将本常量改为 `false`；
 *   2. **删除整个 `mock/` 目录**（其中数据仅供本地预览）；
 *   3. 确认 `CLOUD_ENV_ID` / `APP_ID` 已替换、云函数已部署。
 *
 * 说明：两条数据链路（mock / 真实）都完整保留在 `pages/library/index.ts` 的分支里，
 *       改动本开关即可无缝切换，绝不会为了 mock 破坏真实链路。
 */
export const USE_MOCK_DATA: boolean = false;

/**
 * ⚠️⚠️⚠️ 开发用「虚拟音频时钟」开关（上线前必须置为 false）⚠️⚠️⚠️
 *
 * 历史背景：早期为不依赖云音频的高亮调试而设置此开关。
 *       为了让**逐词高亮**能在「无音频」的前提下被肉眼与脚本验证，
 *       `true` 时播放器页改用 `adapters/wechat/fakeAudio.ts` 的虚拟时钟：
 *       它按真实时间轴推进 `currentTime`，从而驱动逐词高亮与进度推进。
 *
 * 取值语义：
 *   - `true`  ：使用虚拟时钟（无音频，仅驱动时间轴 / 高亮 / 进度）；
 *   - `false` ：使用真实 `InnerAudioContext`（`adapters/wechat/audio.ts`）。
 *
 * 🚨 上线前必做：置为 `false`。
 */
export const USE_FAKE_AUDIO_CLOCK: boolean = false;

/**
 * 云存储 fileID 前缀（可选兜底）。
 * 当 `lessons_index` 集合中未携带 `file_ids` 映射时，
 * `resolveAudioFileId()` 会用它拼接出 fileID。形如：
 *   `cloud://your-env-id.your-env-id-1a2b3c/`
 * 留空表示「仅依赖 file_ids 映射，不做兜底拼接」。
 */
export const CLOUD_STORAGE_FILEID_PREFIX: string =
  'cloud://dev-englishpod-d6ghydrutca03de08.6465-dev-englishpod-d6ghydrutca03de08-1503148834/';

/** 云函数名称映射（与 cloudfunctions/ 下的目录名保持一致）。 */
export const CLOUD_FUNCTION_NAMES = {
  getLessonIndex: 'getLessonIndex',
  getLessonDetail: 'getLessonDetail',
} as const;

/** 单次云函数调用的超时时间（毫秒）。 */
export const CLOUD_CALL_TIMEOUT_MS = 8000;

/** 云函数调用失败时的最大重试次数（不含首次调用）。 */
export const CLOUD_CALL_MAX_RETRIES = 2;

/** 云函数重试的基础退避时长（毫秒），实际退避为 base * 2^attempt。 */
export const CLOUD_CALL_RETRY_BASE_MS = 300;

/** 音频在云存储中的相对逻辑路径模板（与 pipeline 产出的路径约定一致）。 */
export const LESSON_AUDIO_PATH_TEMPLATE = 'audio/{lessonId}/{track}.m4a';

/** 单课详情在云存储中的相对逻辑路径模板。 */
export const LESSON_DETAIL_PATH_TEMPLATE = 'lessons/{lessonId}.json.gz';

/** 课程库列表默认分页大小（首版 335 门课程一次性拉取）。 */
export const LESSON_INDEX_PAGE_SIZE = 335;
