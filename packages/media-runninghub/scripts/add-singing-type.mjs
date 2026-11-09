/**
 * One-off migration: add the singing digital-human task type.
 *
 * Run: node scripts/add-singing-type.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ours = join(here, '..', 'config', 'task-types.json')

const TYPE_ID = 'digital-human-singing'

const doc = JSON.parse(readFileSync(ours, 'utf8'))
if (doc.types.some((t) => t.typeId === TYPE_ID)) {
  console.log(`${TYPE_ID} already present; nothing to do`)
  process.exit(0)
}

/** A media slot feeding one array of the loader's single JSON field. */
const mediaSlot = (name, label, type, mergeAs, accept) => ({
  name,
  label,
  type,
  required: name === 'image' || name === 'audio',
  nodeId: '339',
  fieldName: 'media_state',
  mergeAs,
  accept,
})

const type = {
  typeId: TYPE_ID,
  version: 1,
  displayName: 'MiniMax H3 唱歌对口型数字人',
  description:
    '用一张人物照 + 一段演唱音频，让照片里的人开口唱这段歌：音频被 1:1 复用为目标视频的完整音轨，'
    + '画面按提示词里的分镜演出（口型、表情、身体律动、镜头切换）。'
    + '参考图最多 4 张，可分别用于人物长相、服装、场景等；音频 1 段。'
    + '提示词必须按 references/task-pool.md 附录 C 的六段式格式写，'
    + '参考图用 @图片1 @图片2 … 引用，音频用 @音频1 引用——'
    + '控件保存时会把它们统一替换成占位符，编号信息不会保留，'
    + '所以每张图的用途要在 subject_definitions 与 retention_analysis 里用文字说清楚。'
    + '成片为节点 308 输出的 mp4，时长由 seconds 决定（音频更长时按 seconds 截断）。',
  workflowId: '2119790027898179586',
  instanceType: 'plus',
  params: [
    mediaSlot('image', '参考图 1（人物长相/体型）', 'image', 'images', ['.jpg', '.jpeg', '.png', '.webp']),
    mediaSlot('image2', '参考图 2（可选：服装）', 'image', 'images', ['.jpg', '.jpeg', '.png', '.webp']),
    mediaSlot('image3', '参考图 3（可选：场景）', 'image', 'images', ['.jpg', '.jpeg', '.png', '.webp']),
    mediaSlot('image4', '参考图 4（可选：其他参考）', 'image', 'images', ['.jpg', '.jpeg', '.png', '.webp']),
    mediaSlot('audio', '演唱音频（音轨来源，必填）', 'audio', 'audios', ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg']),
    {
      name: 'prompt',
      label: '六段式提示词（写法见 references/task-pool.md 附录 C）',
      type: 'text',
      required: true,
      nodeId: '340',
      fieldName: 'prompt',
    },
    {
      name: 'seconds',
      label: '时长（秒）',
      type: 'int',
      required: false,
      default: 8,
      nodeId: '340',
      fieldName: 'seconds',
    },
    {
      name: 'aspectRatio',
      label: '画面比例',
      type: 'enum',
      required: false,
      default: '3:4',
      nodeId: '340',
      fieldName: 'aspect_ratio',
      enum: ['1:1', '2:3', '3:4', '9:16', '16:9', '4:3', '3:2', '21:9'],
    },
  ],
  // The workflow only runs in reference mode: the person in the photo is
  // animated by the audio. Pinning the rest keeps the payload to what a caller
  // can meaningfully choose, and matches the graph's own defaults.
  fixedOverrides: [
    { nodeId: '340', fieldName: 'mode', fieldValue: 'reference' },
    { nodeId: '340', fieldName: 'fps', fieldValue: 24 },
    { nodeId: '340', fieldName: 'resolution', fieldValue: '1080P' },
  ],
}

doc.types.push(type)
writeFileSync(ours, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`inserted ${TYPE_ID}; total types: ${doc.types.length}`)
