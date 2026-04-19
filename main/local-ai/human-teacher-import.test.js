const fs = require('fs-extra')
const os = require('os')
const path = require('path')

const {importHumanTeacherAnnotations} = require('./human-teacher-import')

describe('human-teacher import', () => {
  it('preserves explicit false benchmark-review retraining consent', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'idena-human-teacher-import-')
    )
    const taskManifest = path.join(tempDir, 'tasks.jsonl')
    const annotationsJsonl = path.join(tempDir, 'annotations.jsonl')
    const outputJsonl = path.join(tempDir, 'normalized.jsonl')

    await fs.writeFile(
      taskManifest,
      `${JSON.stringify({
        task_id: 'demo:sample:1',
        sample_id: 'demo:sample:1',
        flip_hash: 'flip-1',
        final_answer: 'left',
      })}\n`,
      'utf8'
    )
    await fs.writeFile(
      annotationsJsonl,
      `${JSON.stringify({
        task_id: 'demo:sample:1',
        text_required: false,
        sequence_markers_present: true,
        report_required: false,
        final_answer: 'left',
        why_answer: 'Human review note',
        confidence: 4,
        benchmark_review_issue_type: 'weak_reasoning',
        benchmark_review_failure_note: 'Keep as audit only.',
        benchmark_review_include_for_training: false,
      })}\n`,
      'utf8'
    )

    const result = await importHumanTeacherAnnotations({
      taskManifestPath: taskManifest,
      annotationsJsonlPath: annotationsJsonl,
      outputJsonlPath: outputJsonl,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      benchmark_review_issue_type: 'weak_reasoning',
      benchmark_review_failure_note: 'Keep as audit only.',
      benchmark_review_include_for_training: false,
    })

    await fs.remove(tempDir)
  })
})
