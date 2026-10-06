// Models left out of CSV backups. Their data is regenerated after an import
// (ArticleEmbedding is rebuilt by the worker-python article embeddings sync),
// and binary columns do not round-trip through the CSV backup format.
export const BACKUP_EXCLUDED_MODELS: string[] = ["ArticleEmbedding"];

export default BACKUP_EXCLUDED_MODELS;
