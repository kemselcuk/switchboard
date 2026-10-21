export async function up(db) {
  await db.schema
    .createTable('flag_legacy_sequences')
    .addColumn('project_id', 'text', (column) => column.primaryKey())
    .addColumn('next_legacy_id', 'integer', (column) => column.notNull())
    .addForeignKeyConstraint(
      'flag_legacy_sequences_project_fk',
      ['project_id'],
      'projects',
      ['id'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();

  const rows = await db
    .selectFrom('flags')
    .select('project_id')
    .select((builder) => builder.fn.max('legacy_id').as('max_legacy_id'))
    .groupBy('project_id')
    .execute();

  for (const row of rows) {
    await db
      .insertInto('flag_legacy_sequences')
      .values({
        project_id: row.project_id,
        next_legacy_id: Number(row.max_legacy_id ?? 0) + 1,
      })
      .execute();
  }
}

export async function down(db) {
  await db.schema.dropTable('flag_legacy_sequences').ifExists().execute();
}
