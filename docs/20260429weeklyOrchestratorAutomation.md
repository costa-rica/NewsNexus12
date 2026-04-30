We want to create a weekly automation. This automation will be an orchestrator of existing automation flows, but combine them into one that can be kicked off and run of the weekend or across multiple days - as some of the individual processes take multiple hours.

I think it will need to be a new service but I would like to explain what we need to have happen then maybe you can suggest the best way to implement. Also there are some open questions in this loosely laid out plan I am sharing. So I want us to discuss these open questions.

In News Nexus once a week we want to run a sequence of automations. These automations are already set up between our db-manager, worker-node and worker-python project. 

The worker-node and worker-python are api's so communicating with them should be done using local http requests. The db-manager is a service but we only want one of its functions the --delete_articles, so (open question #1) maybe we should duplicate this functionality inside of worker-node or worker-python?

The next open question is if each process in this flow has a way for this orchestrator automation to know when each process has been completed. Each process could take some time so it is not clear what would be the best approach.

At the end of this weekly flow I would like to have an excel file that has two status sheets. 
# Automation Flow
Here is flow I want to have happen:
## 1. db-manager: delete_articles
Use the db-manager's deletion of old, unapproved articles that runs when we do `npm start -- --delete_articles` from inside the db-manager project. Since the db-manager does not have an api wrapped around it this call will have to be made using a child process - or add this functionality to one of the worker apps.

## 2. worker-node: /request-google-rss
We should run the worker-node's /request-google-rss process. this is triggered by a request to worker-node using POST /request-google-rss/start-job.

This process should run until it stops but no more than 24 hours. It may stop for multiple reasons: 1) which could be from finishing the list of queries in the automation spreadsheet, 2) an error, 3) Google limits us. 

Once the Google RSS request process is complete we should keep a count of the articles it added because this will be important for the next processes. Or maybe we should store the first and last articleId added in this process. Which ever is easiest and lend itself for the next steps in this automation.

This process should include the scraping which is piggy backed of each request. When building this if the scraping is not included for some reason we need to revisit this and make sure our scraping process was attempted.

## 3. worker-node: /state-assigner
After the Google RSS (including the web scraping) has run we want to run the AI State Assigner on all newly added articles. This process can be started by making a request to the worker-node's POST /state-assigner/start-job endpoint.

This is where the count of articles (from the [2. worker-node: /request-google-rss] step) would be ideal because the AI state assigner allows for an argument to limit the number of articles analyzed.

## 4. worker-python: /ai-approver
After we run the AI state assigner we should run the AI article approver flow. This process can be started by making a request to the worker-python's POST /ai-approver/start-job endpoint.

This will also have an argument for the number of articles it analyzes. We want to pass the number of articles it should analyze that was determined by the [2. worker-node: /request-google-rss] step.

It also has an argument for analyzing only articles that have an ai state assigned to them. We should analyze all of them regardless of having a state assigned or not.

## 5. worker-node: /semantic-scorer
After the AI approver has been run to completion we want to set of the semantic-scorer. This can be done by making a request to the worker-node's POST /semantic-scorer/start-job endpoint.

## 6. Excel Spreadsheet report
After this has been completed we want to move on to the excel spreadsheet reporting phase. 
One will identifies all the added articles and information about the articles. So the columns should be:
1. articleId
2. title
3. scrape status
4. ai assigned state
5. ai approver score
6. semantic rating
The second sheet will be a status of each job it set off so it will have the job name, the start time,  end time, duration, and reason for ending.

Some of this data can be collected from querying the database but it would also be good to have the second sheet as a running status tracker. 

This orchestrator will need to keep track of these data and the queue.
The name of this excel file should begin with the date YYYYMMDD-orchestration-report.xlsx. If for some reason there are multiple in the same day add the HHMM_SS to the end of the following files.

# How to start this orchestrator flow
Ideally we would have an added section in the https://news-nexus.kineticmetrics.com/articles/automations page called "Orchestrator". I'd like there to be checkboxes for each of the six steps I just described. And if any one is unchecked then that step could be skipped.

So maybe this orchestrator service can be designed modularly where each subprocesses can be toggled on or off. 
Open question: should we track orchestrator runs in a new Postgres database table or store JSON files perhaps in the News Nexus `PATH_UTILTIES` .env path that is used by both the worker-node and worker-python. And we can add a new subdirectory called orchestrator. 

Ideally adding a new database table would be cleaner. How many tables would be needed.

# Should Orchestrator be an API?
Another open question is if this orchestrator should be wrapped in an API so that the portal (automations page) - api - http request to orchestrator. Or should this be a standalone microservice that gets triggered by terminal command.

Ideally our users can kick off an orchestrator job from the website. The only issue is if they want to cancel the orchestrator job then we need to cancel the subprocess as well.