async function ensureSequence(trx, projectId) {
  let row = await trx
    .selectFrom('flag_legacy_sequences')
    .selectAll()
    .where('project_id', '=', projectId)
    .executeTakeFirst();

  if (row) {
    return row;
  }

  const maxRow = await trx
    .selectFrom('flags')
    .select((builder) => builder.fn.max('legacy_id').as('max_legacy_id'))
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const next = Number(maxRow?.max_legacy_id ?? 0) + 1;

  await trx
    .insertInto('flag_legacy_sequences')
    .values({ project_id: projectId, next_legacy_id: next })
    .onConflict((conflict) => conflict.column('project_id').doNothing())
    .execute();

  row = await trx
    .selectFrom('flag_legacy_sequences')
    .selectAll()
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();

  return row;
}

export async function nextLegacyId(trx, projectId) {
  await ensureSequence(trx, projectId);

  const updated = await trx
    .updateTable('flag_legacy_sequences')
    .set((builder) => ({
      next_legacy_id: builder('next_legacy_id', '+', 1),
    }))
    .where('project_id', '=', projectId)
    .returning('next_legacy_id')
    .executeTakeFirstOrThrow();

  return updated.next_legacy_id - 1;
}

export async function reserveLegacyId(trx, projectId, preferred) {
  if (!Number.isInteger(preferred) || preferred < 1) {
    return nextLegacyId(trx, projectId);
  }

  const taken = await trx
    .selectFrom('flags')
    .select('id')
    .where('project_id', '=', projectId)
    .where('legacy_id', '=', preferred)
    .executeTakeFirst();

  if (taken) {
    return nextLegacyId(trx, projectId);
  }

  const sequence = await ensureSequence(trx, projectId);

  if (preferred >= sequence.next_legacy_id) {
    await trx
      .updateTable('flag_legacy_sequences')
      .set({ next_legacy_id: preferred + 1 })
      .where('project_id', '=', projectId)
      .execute();
  }

  return preferred;
}
