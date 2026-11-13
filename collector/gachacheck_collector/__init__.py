"""GachaCheck collector: reads official game announcements and sends event dates to the ingest function.

The collector only fetches and parses. It never converts time zones, never decides what is
trusted in the end, and never talks to the database. See supabase/functions/ingest/README.md
for the contract it sends to.
"""
