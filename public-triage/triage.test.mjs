import test from 'node:test'
import assert from 'node:assert/strict'
import { sweep, judge, faqFor } from './triage.mjs'

const body =
  'The public parser `parse_frame` accepts a truncated length field and returns a successful zero-length payload instead of rejecting the frame.'
const bug = (number, extra = {}) => ({
  number,
  node_id: 'I_' + number,
  title: 'Truncated length silently succeeds',
  body,
  state: 'open',
  labels: [{ name: 'bug' }],
  locked: false,
  assignees: [],
  milestone: null,
  comments: 0,
  updated_at: 'before',
  ...extra,
})
const repo = 'flop-labs/network'

function fixture(
  items,
  {
    repoLabels = ['bug', 'question'],
    timeline = {},
    meta = {},
    doc = '## Links\n[Devnet explorer](https://explorer.devnet.flop.network)',
    beforeLive,
    afterComment,
    pullFiles = ['src/parser.js'],
    pullInfo = () => ({
      state: 'open',
      head: { sha: 'head' },
      base: { sha: 'base' },
      changed_files: pullFiles.length,
    }),
  } = {},
) {
  const stored = structuredClone(items)
  const writes = [],
    logs = [],
    reads = []
  const request = (path, { method = 'GET', body: data, pages = false } = {}) => {
    const rel = path.replace('repos/' + repo, '')
    if (method !== 'GET') writes.push({ path: rel, method, data })
    else reads.push(rel)
    if (rel === '') return { full_name: repo, visibility: 'public', default_branch: 'main', ...meta }
    if (rel.startsWith('/issues?')) {
      assert.equal(pages, true)
      return structuredClone(stored.filter((r) => r.state === 'open'))
    }
    if (rel.startsWith('/labels?')) return repoLabels.map((name) => ({ name }))
    if (rel.startsWith('/contents/'))
      return {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(doc).toString('base64'),
      }
    if (/^\/pulls\/\d+\/files\?per_page=100$/.test(rel))
      return pullFiles.map((filename) => ({ filename, patch: 'diff contents' }))
    if (/^\/pulls\/\d+$/.test(rel)) return pullInfo()
    if (rel === 'graphql') {
      assert.equal(data.variables.original.startsWith('I_'), true)
      const victim = stored.find((r) => r.node_id === data.variables.issue)
      victim.state = 'closed'
      return { data: { closeIssue: { issue: { state: 'CLOSED' } } } }
    }
    const [, id, suffix] = rel.match(/^\/issues\/(\d+)(.*)$/)
    const item = stored.find((r) => r.number === Number(id))
    if (!suffix && method === 'GET') {
      beforeLive?.(item)
      return structuredClone(item)
    }
    if (!suffix && method === 'PATCH') {
      item.state = data.state
      return item
    }
    if (suffix.startsWith('/timeline?')) {
      assert.equal(pages, true)
      return timeline[id] ?? []
    }
    if (suffix === '/labels') {
      item.labels.push(...data.labels.map((name) => ({ name })))
      return item.labels
    }
    if (suffix === '/comments') {
      ;(timeline[id] ??= []).push({
        event: 'commented',
        user: { login: 'github-actions[bot]' },
        body: data.body,
      })
      item.comments++
      afterComment?.(item)
      return {}
    }
    throw Error('unexpected path: ' + rel)
  }
  return {
    writes,
    reads,
    logs,
    stored,
    run: (options = {}) =>
      sweep({ repo, request, apply: true, day: 0, log: (m) => logs.push(m), ...options }),
  }
}

test('use only available labels, preserve existing decisions, classify PRs, respect removals', async () => {
  const f = fixture(
    [
      bug(1, { title: 'fix(net): retry DNS', labels: [{ name: 'status:triage' }], pull_request: {} }),
      bug(2, { title: 'fix: DNS', labels: [{ name: 'type:critique' }] }),
      bug(3, { title: 'feat: new parser', labels: [] }),
      bug(4, { title: 'Unhandled frame', labels: [] }),
      bug(5, { title: 'fix: restored after label removal', labels: [] }),
    ],
    {
      repoLabels: ['type:bug', 'type:question'],
      timeline: { 5: [{ event: 'unlabeled', label: { name: 'type:bug' } }] },
    },
  )
  await f.run({
    key: 'fixture',
    decide: async (state) => (state.itemType === 'pull_request' ? 'bug' : 'question'),
  })
  assert.deepEqual(
    f.writes.map((w) => [w.path, w.data.labels]),
    [
      ['/issues/1/labels', ['type:bug']],
      ['/issues/4/labels', ['type:question']],
    ],
  )
  assert.deepEqual(
    f.stored[0].labels.map((l) => l.name),
    ['status:triage', 'type:bug'],
  )
})

test('exact and prefixed reposts all point directly to the oldest open issue, PRs stay open', async () => {
  const f = fixture([
    bug(1),
    bug(2, { title: 'bug: Truncated length silently succeeds' }),
    bug(3),
    bug(4, { pull_request: {} }),
    bug(5, { body: body + ' A second outcome is required.' }),
  ])
  await f.run()
  assert.deepEqual(
    f.writes.map((w) => w.data.variables),
    [
      { issue: 'I_2', original: 'I_1' },
      { issue: 'I_3', original: 'I_1' },
    ],
  )
  assert.match(f.writes[0].data.query, /stateReason: DUPLICATE, duplicateIssueId: \$original/)
  assert.deepEqual(await f.run(), { added: 0, closures: 0 })
})

test('a semantic match needs a direct shared identifier and a positive full-scope judgment', async () => {
  const f = fixture([
    bug(1),
    bug(2, { body: body.replace('accepts', 'does not reject') }),
    bug(3, { body: body + ' Also change the streaming parser.' }),
    bug(4, { body: body.replace('`parse_frame`', '`encode_frame`') }),
  ])
  await f.run({
    key: 'fixture',
    decide: async (state, q) => {
      assert.equal(q.type, 'noul')
      return !state.report.body.includes('Also change')
    },
  })
  assert.deepEqual(
    f.writes.map((w) => w.data.variables),
    [{ issue: 'I_2', original: 'I_1' }],
  )
})

test('protect scope changes, fresh assignments, reopened reports and personal access requests', async () => {
  const f = fixture(
    [
      bug(1),
      bug(2),
      bug(3),
      bug(4, { assignees: [{}] }),
      bug(5, { comments: 1 }),
      bug(6, { title: 'access: request' }),
      bug(7, { title: 'fix: security issue' }),
      bug(8, { milestone: {} }),
    ],
    {
      timeline: { 2: [{ event: 'reopened' }] },
      beforeLive: (item) => {
        if (item.number === 3) item.assignees = [{}]
      },
    },
  )
  await f.run()
  assert.deepEqual(f.writes, [])
  const closed = fixture([bug(1), bug(2)], {
    beforeLive: (item) => {
      if (item.number === 1) item.state = 'closed'
    },
  })
  await closed.run()
  assert.deepEqual(closed.writes, [])
})

const faq = (n, extra = {}) =>
  bug(n, {
    title: 'Question: where is the devnet explorer?',
    body: '',
    labels: [{ name: 'question' }],
    ...extra,
  })

test('FAQ closure cites checked public docs and refuses extra requests or discussion', async () => {
  const f = fixture(
    [
      faq(1),
      faq(2, { body: 'It also fails to load for me.' }),
      faq(3, { comments: 1 }),
      faq(4, { pull_request: {} }),
    ],
    { timeline: { 3: [{ event: 'commented', user: { login: 'user' }, body: 'Please fix this' }] } },
  )
  await f.run()
  assert.deepEqual(
    f.writes.map((w) => w.path),
    ['/issues/1/comments', '/issues/1'],
  )
  assert.match(
    f.writes[0].data.body,
    /https:\/\/github\.com\/flop-labs\/network\/blob\/main\/README\.md#links/,
  )
  assert.equal(f.writes[1].data.state, 'closed')
  assert.deepEqual(await f.run(), { added: 0, closures: 0 })
})

test('retry after failure between FAQ comment and close reuses only the matching bot answer', async () => {
  let fail = true
  const opts = {
    afterComment: () => {
      if (fail) {
        fail = false
        throw Error('interrupted')
      }
    },
  }
  const f = fixture([faq(1)], opts)
  await assert.rejects(f.run(), /interrupted/)
  await f.run()
  assert.deepEqual(
    f.writes.map((w) => w.path),
    ['/issues/1/comments', '/issues/1'],
  )
  const fake = fixture([faq(1, { comments: 1 })], {
    timeline: { 1: [{ event: 'commented', user: { login: 'visitor' }, body: f.writes[0].data.body }] },
  })
  await fake.run()
  assert.deepEqual(fake.writes, [])
})

test('dry run never writes, quotas bound each pass, and private or archived repos fail before scanning', async () => {
  const f = fixture(Array.from({ length: 54 }, (_, n) => bug(n + 1)))
  assert.equal((await f.run({ apply: false })).closures, 5)
  assert.deepEqual(f.writes, [])
  assert.match(f.logs.at(-1), /scanned 48\/54/)
  for (const meta of [{ visibility: 'private' }, { archived: true }, { fork: true }]) {
    const guarded = fixture([bug(1)], { meta })
    await assert.rejects(guarded.run(), /active public/)
    assert.deepEqual(guarded.reads, [''])
  }
})

test('Jev validates the pinned model, answer shape and probability distribution', async () => {
  const q = { type: 'choice', criteria: { bug: 'bug', other: 'other' } }
  const answer = {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.96, other: 0.04 },
    confidence: 0.96,
  }
  const mock =
    (a, model = 'jev-1.13.0') =>
    async () => ({ ok: true, json: async () => ({ model, answers: { decision: a } }) })
  assert.equal(await judge({}, q, 'fixture', mock(answer)), 'bug')
  assert.equal(await judge({}, q, 'fixture', mock({ ...answer, confidence: 0.8 })), 'other')
  await assert.rejects(judge({}, q, 'fixture', mock(answer, 'unknown')), /envelope/)
  await assert.rejects(judge({}, q, 'fixture', mock({ ...answer, probabilities: { bug: 1 } })), /choice/)
  await assert.rejects(
    judge({}, { type: 'noul' }, 'fixture', mock({ type: 'noul', noul: true })),
    /probability/,
  )
})

test('FAQ uses the full yellowpaper form and refuses a changed document or new human activity', async () => {
  const form =
    '### Version and section\n\n_No response_\n\n### Your question\n\nHow can I report a typo?'
  assert.ok(faqFor('flop-labs/yellowpaper', { title: 'question:', body: form }))
  assert.equal(
    faqFor('flop-labs/yellowpaper', { title: 'question:', body: form + ' Also, fix §2.' }),
    undefined,
  )
  assert.equal(faqFor('flop-labs/yellowpaper', { title: 'question:', body: '' }), undefined)
  const changed = fixture([faq(1)], { doc: '## Links\nThe explorer has moved.' })
  await changed.run()
  assert.deepEqual(changed.writes, [])
  const assigned = fixture([faq(1)], {
    beforeLive: (item) => {
      item.assignees = [{}]
    },
  })
  await assigned.run()
  assert.deepEqual(assigned.writes, [])
  const intervened = fixture([faq(1)], {
    afterComment: (item) => {
      item.comments++
    },
  })
  await intervened.run()
  assert.deepEqual(
    intervened.writes.map((w) => w.path),
    ['/issues/1/comments'],
  )
})

test('a conventional bug title can label a security disclaimer without sending it to Jev', async () => {
  const f = fixture([
    bug(1, {
      title: 'fix(scan): preserve literal hash',
      labels: [],
      body: body + ' No exploit testing.',
    }),
  ])
  await f.run({ key: 'fixture', decide: () => assert.fail('unexpected model request') })
  assert.deepEqual(
    f.writes.map((w) => w.path),
    ['/issues/1/labels'],
  )
})

test('Jev sees the actual PR paths and can abstain despite a fix prefix; a question can request a docs correction', async () => {
  const samples = [
    bug(1, { title: 'fix: reject a wrong key', labels: [], pull_request: {} }),
    bug(2, { title: 'question: why do the FAQ and spec disagree?', labels: [] }),
  ]
  const f = fixture(samples, {
    pullFiles: ['tests/unit/test_key.py', 'tests/fixtures/key.json'],
    repoLabels: ['bug', 'question', 'documentation'],
  })
  const seen = []
  await f.run({
    key: 'fixture',
    decide: async (state, q) => {
      seen.push(state)
      assert.match(q.instructions, /only regression tests/)
      assert.match(q.instructions, /contradictory public documentation/)
      if (state.itemType === 'issue') {
        assert.match(q.instructions, /actual software behavior violates a documented contract/)
        assert.match(q.instructions, /inaccurate descriptions of intended behavior/)
      } else {
        assert.doesNotMatch(q.instructions, /proposed remedies/)
      }
      return state.itemType === 'pull_request' ? 'other' : 'documentation'
    },
  })
  assert.deepEqual(seen, [
    {
      title: samples[0].title,
      body,
      itemType: 'pull_request',
      changedFilePaths: ['tests/unit/test_key.py', 'tests/fixtures/key.json'],
    },
    { title: samples[1].title, body, itemType: 'issue' },
  ])
  assert.deepEqual(
    f.writes.map((w) => [w.path, w.data.labels]),
    [['/issues/2/labels', ['documentation']]],
  )
})

test('abstain on incomplete PR file lists or a changed revision', async () => {
  const sample = bug(1, { title: 'fix: parser', labels: [], pull_request: {} })
  for (const count of [0, 2, 101]) {
    const f = fixture([sample], { pullInfo: () => ({ changed_files: count }) })
    await f.run({ key: 'fixture', decide: () => assert.fail('incomplete context reached Jev') })
    assert.deepEqual(f.writes, [])
  }
  let revision = 0
  const changed = fixture([sample], {
    pullInfo: () => ({
      state: 'open',
      changed_files: 1,
      head: { sha: String(++revision) },
      base: { sha: 'base' },
    }),
  })
  await changed.run({ key: 'fixture', decide: async () => 'bug' })
  assert.deepEqual(changed.writes, [])
})
