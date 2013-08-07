import psycopg2, psycopg2.extras, json
import requests as HTTP

config = dict()
with open('config.json') as config_file:
  config = json.load(config_file)

conn = psycopg2.connect("dbname=%s user=%s" % (config["dbname"], config["dbuser"]))
cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

def email_all(subject, message):
  cur.execute("SELECT name, email FROM users")
  for u in cur.fetchall():
    envelope = {"from": "Dave from Parley <dave@blackchair.net>",
        "to": [u['email']],
        "subject": subject,
        "text": message}
    print HTTP.post(
        "https://api.mailgun.net/v2/parley.co/messages",
        auth=("api", config["mailgun_api_key"]),
        data=envelope)
