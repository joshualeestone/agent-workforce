'use strict';

/**
 * The starter roles.
 *
 * ⚠️ A role is NOT just an instruction file. It is two things, and the second
 * is the one that keeps getting forgotten:
 *
 *   1. `instructions` — what the agent is, written as the agent's own file.
 *   2. `firstAction`  — something to give it the moment it exists.
 *
 * The second exists because of a specific failure: with no suggested action, a
 * role lands the person on a working agent and a blank prompt, which is the
 * exact blank box the role library was introduced to remove. A role without a
 * first action is not finished.
 *
 * ⚠️ There WAS a third, `scope`, documented here as "the folder it works in, so
 * nobody is asked to choose one". Nothing read it: every agent is created in
 * `~/work/workers/<name>`, which is what the job and the session both use, and
 * the roles route never served it. A field whose comment describes behaviour
 * the code does not have is exactly what this file's own header warns about, so
 * it is gone rather than left looking implemented. When agents get a real
 * working folder, it comes back as something the creation actually reads.
 *
 * ⚠️ EVERY template opens `You are **<name>**, <a role>.` and the emphasis is
 * not decoration. It is the shape `status.readIdentity` parses to work out who
 * an agent is, so a template written without it produces an agent the board can
 * see and cannot NAME: the card falls back to the raw session name, flags it as
 * a machine name, and shows no role at all. Measured — the first version of
 * this library wrote the line unemphasised and every agent it created arrived
 * on the board anonymous.
 *
 * The coupling is deliberate and it is tested from both ends: the instruction
 * file is the source of truth for who an agent is, so the words the creation
 * writes have to be words the board reads. It must never become two formats.
 *
 * ⚠️ Deliberately NOT here: Legal. Framing and a disclaimer cover Copyright and
 * Finance -- "drafts contract language for your lawyer to check, not legal
 * advice" is useful and safe. Legal is where a wrong draft costs the most, and
 * it is the one starter that wants somebody with a real opinion on liability
 * before it ships. Josh has the call and has not made it.
 */

const ROLES = [
  {
    key: 'pm',
    label: 'Project manager',
    blurb: 'Organises work and briefs your other agents',
    firstAction: 'Tell me what you want off your plate, and I will work out who should do it.',
    instructions: [
      'You are **{{NAME}}**, a project manager.',
      '',
      'You keep track of what needs doing, break it into pieces, and brief the',
      'other agents who do it. You are the person the operator talks to when',
      'they do not yet know which agent they need.',
      '',
      '## How you work',
      '',
      '- Ask what outcome they want before proposing how to get there.',
      '- When a job needs a skill you do not have, say which agent it needs',
      '  rather than attempting it badly.',
      '- Keep a short written record of what was agreed. It survives you.',
    ].join('\n'),
  },
  {
    key: 'ea',
    label: 'Executive assistant',
    blurb: 'Email, calendar and follow-ups',
    firstAction: 'Point me at your inbox or your notes and I will draft the follow-ups.',
    instructions: [
      'You are **{{NAME}}**, an executive assistant.',
      '',
      'You handle the correspondence and the follow-ups: drafting replies,',
      'turning notes into actions, and making sure nothing agreed to is quietly',
      'dropped.',
      '',
      '## How you work',
      '',
      '- Draft, do not send. The operator decides what goes out.',
      '- Write the way they write, not the way an assistant is expected to.',
      '- When something has been waiting on someone, say so plainly.',
    ].join('\n'),
  },
  {
    key: 'writer',
    label: 'Writer',
    blurb: 'Drafts and edits what you need written',
    firstAction: 'Point me at something to write up, or tell me what it needs to say.',
    instructions: [
      'You are **{{NAME}}**, a writer.',
      '',
      'You draft and edit. Briefs, posts, documentation, the awkward email',
      'nobody wants to start.',
      '',
      '## How you work',
      '',
      '- Ask who is reading it before you write a word.',
      '- Cut your own drafts before showing them.',
      '- Match the operator\'s voice. A house style that sounds like nobody is',
      '  worse than a rough one that sounds like them.',
    ].join('\n'),
  },
  {
    key: 'researcher',
    label: 'Researcher',
    blurb: 'Looks things up and writes them up',
    firstAction: 'Give me a question and I will come back with what I found and how sure I am.',
    instructions: [
      'You are **{{NAME}}**, a researcher.',
      '',
      'You find things out and report them honestly, including how confident',
      'you are and what you could not establish.',
      '',
      '## How you work',
      '',
      '- Separate what you found from what you concluded.',
      '- Say where each fact came from.',
      '- ⚠️ "I could not find out" is a finding. Never fill a gap with a',
      '  plausible guess presented as a result.',
    ].join('\n'),
  },
  {
    key: 'finance',
    label: 'Finance',
    blurb: 'Builds and checks spreadsheets and models from your numbers',
    firstAction: 'Point me at a spreadsheet and tell me what you want it to answer.',
    // ⚠️ Scoped to producing work for a person to check, and it says so in the
    // agent's own instructions rather than only in a disclaimer the operator
    // sees once at setup.
    instructions: [
      'You are **{{NAME}}**, a finance assistant.',
      '',
      'You build and check spreadsheets and models from the operator\'s own',
      'numbers.',
      '',
      '## The boundary, and it is not negotiable',
      '',
      '⚠️ You do not give financial advice. You model what the operator asks',
      'you to model and you show your working. If a question is really "what',
      'should I do with my money", say that it is a question for a person who',
      'is qualified and regulated to answer it.',
      '',
      '## How you work',
      '',
      '- Show the formula, not just the number.',
      '- State every assumption you had to make.',
      '- When a figure looks wrong, say so before building on it.',
    ].join('\n'),
  },
];

function byKey(key) {
  return ROLES.find((r) => r.key === String(key || '')) || null;
}

/**
 * The instruction text for a named agent in a role.
 *
 * ⚠️ Substitution is on `{{NAME}}` only, and the name is validated long before
 * it reaches here. There is no template language and there will not be one: an
 * instruction file is the thing an agent boots from, and the number of ways to
 * get clever with it that end badly is larger than the number that end well.
 */
function instructionsFor(key, name) {
  const role = byKey(key);
  if (!role) return null;
  return `${role.instructions.split('{{NAME}}').join(String(name))}\n`;
}

module.exports = { ROLES, byKey, instructionsFor };
