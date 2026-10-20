export async function up(db) {
  await db.schema
    .alterTable('flags')
    .addColumn('legacy_id', 'integer')
    .execute();

  const flags = await db
    .selectFrom('flags')
    .select(['id', 'project_id'])
    .orderBy('project_id')
    .orderBy('created_at')
    .orderBy('id')
    .execute();

  const nextByProject = new Map();

  for (const flag of flags) {
    const next = (nextByProject.get(flag.project_id) ?? 0) + 1;

    nextByProject.set(flag.project_id, next);
    await db
      .updateTable('flags')
      .set({ legacy_id: next })
      .where('id', '=', flag.id)
      .execute();
  }

  await db.schema
    .createIndex('flags_project_legacy_id_unique')
    .on('flags')
    .columns(['project_id', 'legacy_id'])
    .unique()
    .execute();
}

export async function down(db) {
  await db.schema
    .dropIndex('flags_project_legacy_id_unique')
    .ifExists()
    .execute();
  await db.schema.alterTable('flags').dropColumn('legacy_id').execute();
}
