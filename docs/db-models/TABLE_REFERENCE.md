# Table Reference

Database table reference for NewsNexus12 (PostgreSQL via Sequelize ORM).

**Note**: All tables include `createdAt` and `updatedAt` timestamp fields (DATE, NOT NULL).

## Core Tables

### Article

- **Table name**: `Articles`

| Column                  | Type     | Constraints        | Notes                       |
| ----------------------- | -------- | ------------------ | --------------------------- |
| id                      | INTEGER  | PK, Auto Increment |                             |
| publicationName         | STRING   | NULL               | News source name            |
| author                  | STRING   | NULL               |                             |
| title                   | STRING   | NULL               | Article headline            |
| description             | STRING   | NULL               | Article summary/excerpt     |
| url                     | STRING   | NULL               | Original article URL        |
| urlToImage              | STRING   | NULL               | Featured image URL          |
| publishedDate           | DATEONLY | NULL               | Publication date            |
| entityWhoFoundArticleId | INTEGER  | FK, NULL           | → EntityWhoFoundArticles.id |
| newsApiRequestId        | INTEGER  | FK, NULL           | → NewsApiRequests.id        |
| newsRssRequestId        | INTEGER  | FK, NULL           | → NewsRssRequests.id        |

**Relationships**:

- belongsTo EntityWhoFoundArticle (via `entityWhoFoundArticleId`)
- belongsTo NewsApiRequest (via `newsApiRequestId`)
- belongsTo NewsRssRequest (via `newsRssRequestId`)
- hasMany ArticleContents02, ArticleApproved, ArticlesApproved02, ArticleReviewed, ArticleIsRelevant, ArticleDuplicateAnalysis, ArticleStateContract, ArticleStateContract02, ArticleKeywordContract, ArticleReportContract, ArticleEntityWhoCategorizedArticleContract, ArticleEntityWhoCategorizedArticleContracts02
- hasOne AiApproverArticlePredictionV02 (via `articleId`)
- belongsToMany State (through ArticleStateContract)

---

### ArticleApproved

- **Table name**: `ArticleApproveds`

| Column                      | Type     | Constraints        | Notes                   |
| --------------------------- | -------- | ------------------ | ----------------------- |
| id                          | INTEGER  | PK, Auto Increment |                         |
| userId                      | INTEGER  | FK, NOT NULL       | → Users.id              |
| articleId                   | INTEGER  | FK, NOT NULL       | → Articles.id           |
| isApproved                  | BOOLEAN  | DEFAULT true       |                         |
| headlineForPdfReport        | STRING   | NULL               |                         |
| publicationNameForPdfReport | STRING   | NULL               |                         |
| publicationDateForPdfReport | DATEONLY | NULL               |                         |
| textForPdfReport            | STRING   | NULL               |                         |
| urlForPdfReport             | STRING   | NULL               |                         |
| kmNotes                     | STRING   | NULL               | Knowledge manager notes |

**Relationships**:

- belongsTo User (via `userId`)
- belongsTo Article (via `articleId`)

---

### ArticlesApproved02

- **Table name**: `ArticlesApproved02`

| Column                      | Type     | Constraints        | Notes                        |
| --------------------------- | -------- | ------------------ | ---------------------------- |
| id                          | INTEGER  | PK, Auto Increment |                              |
| artificialIntelligenceId    | INTEGER  | FK, NOT NULL       | → ArtificialIntelligences.id |
| articleId                   | INTEGER  | FK, NOT NULL       | → Articles.id                |
| isApproved                  | BOOLEAN  | DEFAULT true       |                              |
| headlineForPdfReport        | STRING   | NULL               |                              |
| publicationNameForPdfReport | STRING   | NULL               |                              |
| publicationDateForPdfReport | DATEONLY | NULL               |                              |
| textForPdfReport            | STRING   | NULL               |                              |
| urlForPdfReport             | STRING   | NULL               |                              |
| kmNotes                     | STRING   | NULL               | Knowledge manager notes      |

**Relationships**:

- belongsTo ArtificialIntelligence (via `artificialIntelligenceId`)
- belongsTo Article (via `articleId`)

---

### ArticleContents02

- **Table name**: `ArticleContents02`

| Column              | Type    | Constraints        | Notes                                  |
| ------------------- | ------- | ------------------ | -------------------------------------- |
| id                  | INTEGER | PK, Auto Increment |                                        |
| articleId           | INTEGER | FK, NOT NULL       | → Articles.id                          |
| url                 | TEXT    | NULL               | Resolved publisher URL when available  |
| googleRssUrl        | TEXT    | NOT NULL           | Original discovery URL                 |
| googleFinalUrl      | TEXT    | NULL               | Final Google URL after navigation      |
| publisherFinalUrl   | TEXT    | NULL               | Final publisher URL after redirects    |
| title               | TEXT    | NULL               | Stored title snapshot                  |
| content             | TEXT    | NULL               | Stored article body                    |
| status              | STRING  | NOT NULL           | `success` or `fail`                    |
| failureType         | STRING  | NULL               | Failure classification                 |
| details             | TEXT    | NOT NULL           | Diagnostic details                     |
| extractionSource    | STRING  | NOT NULL           | How the publisher URL was determined   |
| bodySource          | STRING  | NOT NULL           | Where the saved content came from      |
| googleStatusCode    | INTEGER | NULL               | Google navigation response status      |
| publisherStatusCode | INTEGER | NULL               | Publisher fetch response status        |

**Relationships**:

- belongsTo Article (via `articleId`)

---

### ArticleDuplicateAnalysis

- **Table name**: `ArticleDuplicateAnalyses`

| Column               | Type    | Constraints        | Notes                            |
| -------------------- | ------- | ------------------ | -------------------------------- |
| id                   | INTEGER | PK, Auto Increment |                                  |
| articleIdNew         | INTEGER | FK, NOT NULL       | → Articles.id (new article)      |
| articleIdApproved    | INTEGER | FK, NOT NULL       | → Articles.id (approved article) |
| reportId             | INTEGER | FK, NULL           | → Reports.id                     |
| sameArticleIdFlag    | INTEGER | NOT NULL           |                                  |
| articleNewState      | STRING  | NOT NULL           |                                  |
| articleApprovedState | STRING  | NOT NULL           |                                  |
| sameStateFlag        | INTEGER | NOT NULL           |                                  |
| urlCheck             | INTEGER | NOT NULL           | URL similarity score             |
| contentHash          | FLOAT   | NOT NULL           | Content hash similarity          |
| embeddingSearch      | FLOAT   | NOT NULL           | Embedding similarity score       |

**Relationships**:

- belongsTo Article as `newArticle` (via `articleIdNew`)
- belongsTo Article as `approvedArticle` (via `articleIdApproved`)

---

### ArticleIsRelevant

- **Table name**: `ArticleIsRelevants`

| Column     | Type    | Constraints        | Notes         |
| ---------- | ------- | ------------------ | ------------- |
| id         | INTEGER | PK, Auto Increment |               |
| userId     | INTEGER | FK, NOT NULL       | → Users.id    |
| articleId  | INTEGER | FK, NOT NULL       | → Articles.id |
| isRelevant | BOOLEAN | DEFAULT true       |               |
| kmNotes    | STRING  | NULL               |               |

**Relationships**:

- belongsTo User (via `userId`)
- belongsTo Article (via `articleId`)

---

### ArticleReviewed

- **Table name**: `ArticleRevieweds`

| Column     | Type    | Constraints        | Notes         |
| ---------- | ------- | ------------------ | ------------- |
| id         | INTEGER | PK, Auto Increment |               |
| userId     | INTEGER | FK, NOT NULL       | → Users.id    |
| articleId  | INTEGER | FK, NOT NULL       | → Articles.id |
| isReviewed | BOOLEAN | DEFAULT true       |               |
| kmNotes    | STRING  | NULL               |               |

**Relationships**:

- belongsTo User (via `userId`)
- belongsTo Article (via `articleId`)

---

### AiApproverArticlePredictionV02

- **Table name**: `AiApproverArticlePredictionsV02`

| Column            | Type    | Constraints          | Notes                                                        |
| ----------------- | ------- | -------------------- | ------------------------------------------------------------ |
| id                | INTEGER | PK, Auto Increment   |                                                              |
| articleId         | INTEGER | FK, NOT NULL         | → Articles.id                                                |
| promptVersionId   | INTEGER | FK, NOT NULL         | → AiApproverPromptVersionsV02.id                              |
| runId             | INTEGER | FK, NOT NULL         | → AiApproverRunsV02.id                                       |
| resultStatus      | STRING  | NOT NULL             | `completed`, `failed`, or `invalid_response`                  |
| prediction        | STRING  | NULL                 | `approved` or `irrelevant`; required for completed results    |
| reasoning         | TEXT    | NULL                 | Nonblank reasoning required for completed results             |
| errorCode         | STRING  | NULL                 | Workflow or provider error code                               |
| errorMessage      | TEXT    | NULL                 | Workflow or provider error detail                             |
| attemptCount      | INTEGER | NOT NULL, DEFAULT 1  | Valid range is 1–2                                           |
| modelName         | STRING  | NOT NULL             | Model used for the prediction                                 |
| pipelineVersion   | STRING  | NOT NULL             | Pipeline version that produced the prediction                 |
| contentSource     | STRING  | NOT NULL             | `article_contents_02` or `description`                        |
| metadata          | JSONB   | NULL                 | Structured workflow and model metadata                        |
| humanValidation   | BOOLEAN | NULL, DEFAULT null   | Human validation state: approved, rejected, or undetermined   |
| humanComment      | TEXT    | NULL                 | Optional human review comment                                 |

**Indexes**:

- Non-unique indexes on `articleId`, `promptVersionId`, `runId`, `resultStatus`, and `prediction`

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo AiApproverPromptVersionV02 (via `promptVersionId`)
- belongsTo AiApproverRunV02 (via `runId`)

---

### AiApproverPromptVersionV02

- **Table name**: `AiApproverPromptVersionsV02`

| Column           | Type    | Constraints               | Notes                                              |
| ---------------- | ------- | ------------------------- | -------------------------------------------------- |
| id               | INTEGER | PK, Auto Increment        |                                                    |
| title            | STRING  | NULL                      | Optional normalized title for the prompt version   |
| promptInMarkdown | TEXT    | NOT NULL                  | Full nonblank prompt body stored in Markdown       |
| isActive         | BOOLEAN | NOT NULL, DEFAULT false   | Only one prompt version can be active              |
| firstUsedAt      | DATE    | NULL                      | First time the prompt was used by a committed run  |

**Indexes**:

- Unique partial index on `title` when the title is not null
- Unique partial index on `isActive` when `isActive` is true
- Non-unique index on `isActive`

**Relationships**:

- hasMany AiApproverRunV02 (via `activePromptVersionId`)
- hasMany AiApproverArticlePredictionV02 (via `promptVersionId`)

---

### AiApproverRunV02

- **Table name**: `AiApproverRunsV02`

| Column                     | Type    | Constraints               | Notes                                                              |
| -------------------------- | ------- | ------------------------- | ------------------------------------------------------------------ |
| id                         | INTEGER | PK, Auto Increment        |                                                                    |
| jobId                      | STRING  | NULL                      | Queue or worker job identifier                                     |
| activePromptVersionId      | INTEGER | FK, NOT NULL              | → AiApproverPromptVersionsV02.id                                   |
| selectionMode              | STRING  | NOT NULL                  | `article_position_count` or `until_last_approved`                   |
| requestedArticleCount      | INTEGER | NULL                      | Requested count for position-based selection; minimum 1            |
| allowPastApprovedBoundary  | BOOLEAN | NOT NULL, DEFAULT false   | Whether selection may continue beyond the approved boundary        |
| allowDescriptionFallback   | BOOLEAN | NOT NULL, DEFAULT false   | Whether article descriptions may replace unavailable full content  |
| highestArticleIdAtStart    | INTEGER | NOT NULL                  | Highest article ID captured when the run was planned; minimum 1     |
| approvedBoundaryArticleId  | INTEGER | NULL                      | Last approved article boundary captured at planning; minimum 1     |
| plannedEligibleCount       | INTEGER | NOT NULL, DEFAULT 0       | Number of eligible articles in the selection snapshot              |
| attemptedCount             | INTEGER | NOT NULL, DEFAULT 0       | Number of articles attempted                                       |
| completedCount             | INTEGER | NOT NULL, DEFAULT 0       | Number of completed predictions                                    |
| failedCount                | INTEGER | NOT NULL, DEFAULT 0       | Number of failed predictions                                       |
| invalidResponseCount       | INTEGER | NOT NULL, DEFAULT 0       | Number of invalid model responses                                  |
| skippedCount               | INTEGER | NOT NULL, DEFAULT 0       | Number of skipped articles                                         |
| status                     | STRING  | NOT NULL, DEFAULT `draft` | Draft, execution, terminal, or circuit-breaker state                |
| endingReason               | TEXT    | NULL                      | Explanation for the run's terminal state                           |
| modelName                  | STRING  | NOT NULL                  | Model selected for the run                                         |
| selectionSnapshot          | JSONB   | NOT NULL, DEFAULT `[]`    | Planned article IDs and their content sources                      |
| previewToken               | STRING  | NULL                      | Unique token used to commit a previewed run                        |
| previewExpiresAt           | DATE    | NULL                      | Expiration time for the preview token                              |
| startedAt                  | DATE    | NULL                      | Time execution started                                             |
| endedAt                    | DATE    | NULL                      | Time execution ended                                               |

**Indexes**:

- Unique index on `previewToken`
- Non-unique indexes on `jobId`, `status`, `createdAt`, and (`status`, `previewExpiresAt`)

**Relationships**:

- belongsTo AiApproverPromptVersionV02 (via `activePromptVersionId`)
- hasMany AiApproverArticlePredictionV02 (via `runId`)

---

### ArtificialIntelligence

- **Table name**: `ArtificialIntelligences`

| Column               | Type    | Constraints        | Notes                |
| -------------------- | ------- | ------------------ | -------------------- |
| id                   | INTEGER | PK, Auto Increment |                      |
| name                 | STRING  | NOT NULL           | Model name           |
| description          | STRING  | NULL               |                      |
| huggingFaceModelName | STRING  | NULL               | HuggingFace model ID |
| huggingFaceModelType | STRING  | NULL               | Model type/category  |

**Relationships**:

- hasMany EntityWhoCategorizedArticle (via `artificialIntelligenceId`)
- hasMany ArticlesApproved02 (via `artificialIntelligenceId`)

---

### EntityWhoCategorizedArticle

- **Table name**: `EntityWhoCategorizedArticles`

| Column                   | Type    | Constraints        | Notes                        |
| ------------------------ | ------- | ------------------ | ---------------------------- |
| id                       | INTEGER | PK, Auto Increment |                              |
| userId                   | INTEGER | FK, NULL           | → Users.id                   |
| artificialIntelligenceId | INTEGER | FK, NULL           | → ArtificialIntelligences.id |

**Relationships**:

- belongsTo User (via `userId`)
- belongsTo ArtificialIntelligence (via `artificialIntelligenceId`)
- hasMany ArticleKeywordContract, ArticleEntityWhoCategorizedArticleContract, ArticleEntityWhoCategorizedArticleContracts02, ArticleStateContract02

---

### EntityWhoFoundArticle

- **Table name**: `EntityWhoFoundArticles`

| Column                        | Type    | Constraints        | Notes                             |
| ----------------------------- | ------- | ------------------ | --------------------------------- |
| id                            | INTEGER | PK, Auto Increment |                                   |
| userId                        | INTEGER | FK, NULL           | → Users.id                        |
| newsArticleAggregatorSourceId | INTEGER | FK, NULL           | → NewsArticleAggregatorSources.id |

**Relationships**:

- belongsTo User (via `userId`)
- belongsTo NewsArticleAggregatorSource (via `newsArticleAggregatorSourceId`)
- hasMany Article (via `entityWhoFoundArticleId`)

---

### Keyword

- **Table name**: `Keywords`

| Column     | Type    | Constraints        | Notes |
| ---------- | ------- | ------------------ | ----- |
| id         | INTEGER | PK, Auto Increment |       |
| keyword    | STRING  | NOT NULL           |       |
| category   | STRING  | NULL               |       |
| isArchived | BOOLEAN | DEFAULT false      |       |

**Relationships**: None

---

### NewsApiRequest

- **Table name**: `NewsApiRequests`

| Column                              | Type     | Constraints        | Notes                             |
| ----------------------------------- | -------- | ------------------ | --------------------------------- |
| id                                  | INTEGER  | PK, Auto Increment |                                   |
| newsArticleAggregatorSourceId       | INTEGER  | FK, NOT NULL       | → NewsArticleAggregatorSources.id |
| countOfArticlesReceivedFromRequest  | INTEGER  | NULL               |                                   |
| countOfArticlesSavedToDbFromRequest | INTEGER  | NULL               |                                   |
| countOfArticlesAvailableFromRequest | INTEGER  | NULL               |                                   |
| dateStartOfRequest                  | DATEONLY | NULL               | Request date range start          |
| dateEndOfRequest                    | DATEONLY | NULL               | Request date range end            |
| status                              | STRING   | NULL               |                                   |
| url                                 | STRING   | NULL               | API request URL                   |
| andString                           | STRING   | NULL               | Boolean AND search terms          |
| orString                            | STRING   | NULL               | Boolean OR search terms           |
| notString                           | STRING   | NULL               | Boolean NOT search terms          |
| isFromAutomation                    | BOOLEAN  | DEFAULT false      |                                   |

**Relationships**:

- belongsTo NewsArticleAggregatorSource (via `newsArticleAggregatorSourceId`)
- hasMany Article (via `newsApiRequestId`)
- hasMany NewsApiRequestWebsiteDomainContract (via `newsApiRequestId`)

---

### NewsArticleAggregatorSource

- **Table name**: `NewsArticleAggregatorSources`

| Column    | Type    | Constraints        | Notes             |
| --------- | ------- | ------------------ | ----------------- |
| id        | INTEGER | PK, Auto Increment |                   |
| nameOfOrg | STRING  | NULL               | Organization name |
| url       | STRING  | NULL               | Base URL          |
| apiKey    | STRING  | NULL               | API key           |
| isApi     | BOOLEAN | DEFAULT false      | Is API source     |
| isRss     | BOOLEAN | DEFAULT false      | Is RSS source     |

**Relationships**:

- hasOne EntityWhoFoundArticle (via `newsArticleAggregatorSourceId`)
- hasMany NewsApiRequest (via `newsArticleAggregatorSourceId`)
- hasMany NewsRssRequest (via `newsArticleAggregatorSourceId`)
- hasMany NewsArticleAggregatorSourceStateContract (via `newsArticleAggregatorSourceId`)

---

### NewsRssRequest

- **Table name**: `NewsRssRequests`

| Column                              | Type     | Constraints        | Notes                             |
| ----------------------------------- | -------- | ------------------ | --------------------------------- |
| id                                  | INTEGER  | PK, Auto Increment |                                   |
| newsArticleAggregatorSourceId       | INTEGER  | FK, NOT NULL       | → NewsArticleAggregatorSources.id |
| countOfArticlesReceivedFromRequest  | INTEGER  | NULL               |                                   |
| countOfArticlesSavedToDbFromRequest | INTEGER  | NULL               |                                   |
| dateStartOfRequest                  | DATEONLY | NULL               |                                   |
| dateEndOfRequest                    | DATEONLY | NULL               |                                   |
| gotResponse                         | BOOLEAN  | NULL               |                                   |

**Relationships**:

- belongsTo NewsArticleAggregatorSource (via `newsArticleAggregatorSourceId`)
- hasMany Article (via `newsRssRequestId`)

---

### Prompt

- **Table name**: `Prompts`

| Column           | Type    | Constraints        | Notes                        |
| ---------------- | ------- | ------------------ | ---------------------------- |
| id               | INTEGER | PK, Auto Increment |                              |
| promptInMarkdown | TEXT    | NOT NULL           | AI prompt in Markdown format |

**Relationships**:

- hasMany ArticleStateContract02 (via `promptId`)

---

### Report

- **Table name**: `Reports`

| Column                | Type    | Constraints        | Notes              |
| --------------------- | ------- | ------------------ | ------------------ |
| id                    | INTEGER | PK, Auto Increment |                    |
| dateSubmittedToClient | DATE    | NULL               |                    |
| nameCrFormat          | STRING  | NULL               | CR format filename |
| nameZipFile           | STRING  | NULL               | Zip archive name   |
| userId                | INTEGER | FK, NOT NULL       | → Users.id         |

**Relationships**:

- belongsTo User (via `userId`)
- hasMany ArticleReportContract (via `reportId`)

---

### State

- **Table name**: `States`

| Column       | Type    | Constraints        | Notes              |
| ------------ | ------- | ------------------ | ------------------ |
| id           | INTEGER | PK, Auto Increment |                    |
| name         | STRING  | NOT NULL           | State full name    |
| abbreviation | STRING  | NOT NULL           | State abbreviation |

**Relationships**:

- hasMany ArticleStateContract (via `stateId`)
- hasMany ArticleStateContract02 (via `stateId`)
- hasMany NewsArticleAggregatorSourceStateContract (via `stateId`)
- belongsToMany Article (through ArticleStateContract)

---

### User

- **Table name**: `Users`

| Column   | Type    | Constraints        | Notes |
| -------- | ------- | ------------------ | ----- |
| id       | INTEGER | PK, Auto Increment |       |
| username | STRING  | NOT NULL           |       |
| email    | STRING  | NOT NULL           |       |
| password | STRING  | NOT NULL           |       |
| isAdmin  | BOOLEAN | DEFAULT false      |       |

**Relationships**:

- hasMany EntityWhoCategorizedArticle (via `userId`)
- hasMany EntityWhoFoundArticle (via `userId`)
- hasMany Report (via `userId`)
- hasMany ArticleReviewed (via `userId`)
- hasMany ArticleApproved (via `userId`)
- hasMany ArticleIsRelevant (via `userId`)

---

### WebsiteDomain

- **Table name**: `WebsiteDomains`

| Column                | Type    | Constraints        | Notes                    |
| --------------------- | ------- | ------------------ | ------------------------ |
| id                    | INTEGER | PK, Auto Increment |                          |
| name                  | STRING  | NOT NULL           | Domain name              |
| isArchived            | BOOLEAN | DEFAULT false      |                          |
| isArchievedNewsDataIo | BOOLEAN | DEFAULT false      | Archived for NewsData.io |

**Relationships**:

- hasMany NewsApiRequestWebsiteDomainContract (via `websiteDomainId`)

---

## Junction Tables

### ArticleStateContract

- **Table name**: `ArticleStateContracts`

| Column    | Type    | Constraints        | Notes         |
| --------- | ------- | ------------------ | ------------- |
| id        | INTEGER | PK, Auto Increment |               |
| articleId | INTEGER | FK, NOT NULL       | → Articles.id |
| stateId   | INTEGER | FK, NOT NULL       | → States.id   |

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo State (via `stateId`)
- Used as `through` table for Article ↔ State belongsToMany

---

### ArticleStateContract02

- **Table name**: `ArticleStateContracts02`

| Column                 | Type    | Constraints             | Notes                             |
| ---------------------- | ------- | ----------------------- | --------------------------------- |
| id                     | INTEGER | PK, Auto Increment      |                                   |
| articleId              | INTEGER | FK, NOT NULL            | → Articles.id                     |
| stateId                | INTEGER | FK, NULL                | → States.id                       |
| entityWhoCategorizesId | INTEGER | FK, NOT NULL            | → EntityWhoCategorizedArticles.id |
| promptId               | INTEGER | FK, NOT NULL            | → Prompts.id                      |
| isHumanApproved        | BOOLEAN | NOT NULL, DEFAULT false |                                   |
| isDeterminedToBeError  | BOOLEAN | NOT NULL, DEFAULT false |                                   |
| occuredInTheUS         | BOOLEAN | NULL                    |                                   |
| reasoning              | STRING  | NULL                    |                                   |

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo State (via `stateId`)
- belongsTo EntityWhoCategorizedArticle (via `entityWhoCategorizesId`)
- belongsTo Prompt (via `promptId`)

---

### ArticleKeywordContract

- **Table name**: `ArticleKeywordContracts`

| Column                 | Type    | Constraints        | Notes                             |
| ---------------------- | ------- | ------------------ | --------------------------------- |
| id                     | INTEGER | PK, Auto Increment |                                   |
| articleId              | INTEGER | FK, NOT NULL       | → Articles.id                     |
| entityWhoCategorizesId | INTEGER | FK, NOT NULL       | → EntityWhoCategorizedArticles.id |
| ranking                | FLOAT   | NOT NULL           | Keyword relevance score           |

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo EntityWhoCategorizedArticle (via `entityWhoCategorizesId`)

---

### ArticleReportContract

- **Table name**: `ArticleReportContracts`

| Column                         | Type    | Constraints        | Notes           |
| ------------------------------ | ------- | ------------------ | --------------- |
| id                             | INTEGER | PK, Auto Increment |                 |
| reportId                       | INTEGER | FK, NOT NULL       | → Reports.id    |
| articleId                      | INTEGER | FK, NOT NULL       | → Articles.id   |
| articleReferenceNumberInReport | STRING  | NULL               |                 |
| articleAcceptedByCpsc          | BOOLEAN | DEFAULT true       | CPSC acceptance |
| articleRejectionReason         | STRING  | NULL               |                 |

**Relationships**:

- belongsTo Report (via `reportId`)
- belongsTo Article (via `articleId`)

---

### ArticleEntityWhoCategorizedArticleContract

- **Table name**: `ArticleEntityWhoCategorizedArticleContracts`

| Column                 | Type    | Constraints        | Notes                             |
| ---------------------- | ------- | ------------------ | --------------------------------- |
| id                     | INTEGER | PK, Auto Increment |                                   |
| articleId              | INTEGER | FK, NOT NULL       | → Articles.id                     |
| entityWhoCategorizesId | INTEGER | FK, NOT NULL       | → EntityWhoCategorizedArticles.id |
| keyword                | STRING  | NULL               | Detected keyword                  |
| keywordRating          | FLOAT   | NULL               | Keyword confidence score          |

**Unique index**: (`articleId`, `entityWhoCategorizesId`, `keyword`)

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo EntityWhoCategorizedArticle (via `entityWhoCategorizesId`)

---

### ArticleEntityWhoCategorizedArticleContracts02

- **Table name**: `ArticleEntityWhoCategorizedArticleContracts02`

| Column                 | Type    | Constraints        | Notes                             |
| ---------------------- | ------- | ------------------ | --------------------------------- |
| id                     | INTEGER | PK, Auto Increment |                                   |
| articleId              | INTEGER | FK, NOT NULL       | → Articles.id                     |
| entityWhoCategorizesId | INTEGER | FK, NOT NULL       | → EntityWhoCategorizedArticles.id |
| key                    | STRING  | NULL               | Metadata key                      |
| valueString            | STRING  | NULL               | String value                      |
| valueNumber            | FLOAT   | NULL               | Numeric value                     |
| valueBoolean           | BOOLEAN | NULL               | Boolean value                     |

**Unique index**: (`articleId`, `entityWhoCategorizesId`, `key`)

**Relationships**:

- belongsTo Article (via `articleId`)
- belongsTo EntityWhoCategorizedArticle (via `entityWhoCategorizesId`)

---

### NewsApiRequestWebsiteDomainContract

- **Table name**: `NewsApiRequestWebsiteDomainContracts`

| Column                        | Type    | Constraints        | Notes                |
| ----------------------------- | ------- | ------------------ | -------------------- |
| id                            | INTEGER | PK, Auto Increment |                      |
| newsApiRequestId              | INTEGER | FK, NULL           | → NewsApiRequests.id |
| websiteDomainId               | INTEGER | FK, NULL           | → WebsiteDomains.id  |
| includedOrExcludedFromRequest | STRING  | DEFAULT "included" | Filter type          |

**Relationships**:

- belongsTo NewsApiRequest (via `newsApiRequestId`)
- belongsTo WebsiteDomain (via `websiteDomainId`)

---

### NewsArticleAggregatorSourceStateContract

- **Table name**: `NewsArticleAggregatorSourceStateContracts`

| Column                        | Type    | Constraints        | Notes                             |
| ----------------------------- | ------- | ------------------ | --------------------------------- |
| id                            | INTEGER | PK, Auto Increment |                                   |
| stateId                       | INTEGER | FK, NOT NULL       | → States.id                       |
| newsArticleAggregatorSourceId | INTEGER | FK, NOT NULL       | → NewsArticleAggregatorSources.id |

**Relationships**:

- belongsTo State (via `stateId`)
- belongsTo NewsArticleAggregatorSource (via `newsArticleAggregatorSourceId`)
