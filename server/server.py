'''
Most of the server-side stuff just proxies the mailgun/context.io APIs.
All the Parley server does on its own is store encrypted keyrings, more or less.

Note: This script calls a JSON file called config.json for its sensitive DB/API
credentials. The format of that file is:

{
  "dbname":"aaaaa",
  "dbuser":"bbbbb",
  "mailgun_api_key":"ccccccccccc",
  "contextio_api_key":"ddddddddd",
  "contextio_api_secret":"eeeeeeeeeeeeeee"
}

Besides the dependencies listed below, this file requires the python-oauth2 module
'''

from flask import Flask, request, json, jsonify, abort
import requests as HTTP
import contextio
import base64, hmac, hashlib
from urllib import urlencode, quote_plus
import time
import psycopg2
import psycopg2.extras
from itertools import izip

app = Flask(__name__)

config = dict()
with open('config.json') as config_file:
  config = json.load(config_file)

BASE_URL = "http://parley.co:5000" #Test
#BASE_URL = "https://api.parley.co" #Live

#---- ACTUAL PARLEY STUFF ----#
conn = psycopg2.connect("dbname=%s user=%s" % (config["dbname"], config["dbuser"]))
cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

def compare_hashes(a, b):
  #constant-time hash compare function stolen from
  #https://github.com/mitsuhiko/python-pbkdf2/blob/master/pbkdf2.py
  if len(a) != len(b):
    return False
  rv = 0
  for x, y in izip(a, b):
    rv |= ord(x) ^ ord(y)
  return rv == 0

def verifySignature(url, method, formData, secret):
  if not 'sig' in formData or not 'time' in formData:
    return False
  t = abs(time.time() - int(formData['time']))
  old_sig = formData['sig']
  keys = formData.keys()
  keys.remove('sig')
  keys.sort()
  values = map(formData.get, keys)
  url_string = urlencode(zip(keys,values))
  new_sig = hmac.new(
      key=secret,
      msg=method+'|'+url+'?'+url_string,
      digestmod=hashlib.sha256).digest()
  new_sig = quote_plus(base64.encodestring(new_sig).strip())
  return compare_hashes(old_sig, new_sig) and t < 30

def getUser(email):
  cur.execute("SELECT * FROM users WHERE email=%s",[email])
  try:
    return cur.fetchone()
  except ProgrammingError:
    return None

def setUser(email,info):
  info["email"] = email

  user = getUser(email)
  if user:
    #merge info with existing stuff
    meta = dict(user.items() + info.items())
  else:
    meta = info

  #extract separated fields from meta
  fields = dict()
  for key in ["name","secret","keyring","pending","email","account_type","imap_account","paid_invites"]:
    if key in meta.keys():
      fields[key] = meta[key]
      del meta[key]
    else:
      fields[key] = None

  meta_json = json.dumps(meta)

  if user:
    cur.execute("UPDATE users SET name=%s, secret=%s, keyring=%s, pending=%s, account_type=%s, imap_account=%s, paid_invites=%s, meta=%s WHERE email=%s",[fields["name"], fields["secret"], fields["keyring"], fields["pending"], fields["account_type"], fields["imap_account"], fields["paid_invites"], meta_json, fields["email"]])
  else:
    cur.execute("INSERT INTO users (name,email,secret,keyring,pending,account_type,imap_account,paid_invites,meta) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",[fields["name"],fields["email"],fields["secret"],fields["keyring"],fields["pending"],fields["account_type"],fields["imap_account"],fields["paid_invites"],meta_json])
  conn.commit()
  return getUser(email)


@app.route("/u/<email>", methods=['GET','POST'])
def user(email):
  user = getUser(email)
  if request.method == 'GET':
    if user and not user["pending"] and 'sig' in request.args and verifySignature(request.base_url, request.method, request.args, user["secret"]):
      #authenticated. return all info
      return jsonify(**user), 200
    elif user and not user["pending"]:
      #only return public info
      return jsonify(name=user["name"], email=user["email"]), 200
    else:
      abort(404)
  elif request.method == 'POST':
    if user and not user["pending"] and 'keyring' in request.form and 'sig' in request.form and verifySignature(request.base_url, request.method, request.form, user["secret"]):
      #create/update user's keyring
      user = setUser(email,{'keyring':request.form['keyring']})
      return jsonify(**user), 201
    elif user["pending"] and 'p' in request.form:
      new_user = {"pending":False,"secret":request.form['p']}
      for key in ["name","keyring"]:
        if key in request.form:
          new_user[key] = request.form[key]
      user = setUser(email,new_user)
      return jsonify(**user), 201
  else:
    abort(400)
    

#TODO: think about how invites work really carefully. security, conversions, etc
@app.route("/invite/<to>", methods=['POST'])
def invite(to):
  # this is both for free invites and paid ones
  from_user = getUser(request.form["user"])

  paid_invites = from_user["paid_invites"] or 0
  if not paid_invites and 'sig' in request.form:
    paid_invites = -1 #if the user is trying to send a paid invite but has none

  to_user = getUser(to)

  #TODO: modify the following if/else to accomodate for the situation where someone is trying to send a paid invite to an already pending user--if the account type is better than their current invite, it should send the new one. either way it should send a reminder
  if from_user and not from_user["pending"] and 'sig' in request.form and verifySignature(request.base_url, request.method, request.form, from_user["secret"]) and not to_user and paid_invites > 0:
    new_user = setUser(
        to,
        {
          "pending":True,
          "account_type":from_user["account_type"],
          "invited_by":from_user["email"]
        }
        )
    #TODO: SEND PAID INVITE
    paid_invites = paid_invites - 1
    setUser(from_user["email"],{"paid_invites":paid_invites})
  elif not to_user: # if "to" is not already a user or pending user
    new_user = setUser(
        to,
        {
          "pending":True,
          "account_type":0,
          "invited_by":from_user["email"]
        }
        )
    #TODO: SEND FREE INVITE (with upgrade option)
  elif to_user and to_user["pending"]:
    #TODO: send reminder (and see note at top of if/else block)
    pass
  return jsonify(paidInvitesRemaining=paid_invites), 200


#---- MAILGUN STUFF ----#
MAILGUN_API_KEY = config["mailgun_api_key"]

@app.route("/smtp/send", methods=['POST'])
def smtp_send():
  user = getUser(request.form["user"])
  if user and not user["pending"] and 'sig' in request.form and verifySignature(request.base_url, request.method, request.form, user["secret"]):
    message = json.loads(request.form['message'])
    message['from'] = "%s <%s>" % (user["name"], user["email"])
    response = HTTP.post(
        "https://api.mailgun.net/v2/parley.mailgun.org/messages",
        auth=("api", MAILGUN_API_KEY),
        data=message)
    response_dict = response.json()
    return jsonify(**response_dict), 201


#---- CONTEXT.IO STUFF ----#
context_io = contextio.ContextIO(
    consumer_key=config["contextio_api_key"], 
    consumer_secret=config["contextio_api_secret"]
)

@app.route("/imap/connect/<email>", methods=['GET'])
def imap_connect(email):
  user = getUser(email)
  if user and not user["pending"] and 'sig' in request.args and verifySignature(request.base_url, request.method, request.args, user["secret"]):
    time = request.args["time"]
    sig = hmac.new(
        key=config["contextio_api_secret"]+user["secret"],
        msg=email+'|'+time,
        digestmod=hashlib.sha256).digest()
    sig = quote_plus(base64.encodestring(sig).strip())
    resp = context_io.post_connect_token(
        callback_url="%s/imap/new/%s/%s/%s" % (BASE_URL, email, time, sig),
        email=email
        )
    return jsonify(**resp), 200
  else:
    abort(403)

@app.route("/imap/new/<email>/<timestamp>/<sig>", methods=['GET'])
def imap_new(email, timestamp, sig):
  user = getUser(email)
  sig = quote_plus(sig)
  t = abs(time.time() - int(timestamp))
  new_sig = hmac.new(
        key=config["contextio_api_secret"]+user["secret"],
        msg=email+'|'+timestamp,
        digestmod=hashlib.sha256).digest()
  new_sig = quote_plus(base64.encodestring(new_sig).strip())
  if compare_hashes(sig, new_sig) and t < 30*60:
    params = {'token':request.args['contextio_token']}
    token = contextio.ConnectToken(context_io,params)
    token.get()
    account = token.account
    accountDict = {}
    for key in contextio.Account.keys:
      accountDict[key] = getattr(account,key)
    accountDict["parley_imap_type"] = "contextio"
    user = setUser(email,{"imap_account":json.dumps(accountDict)})
    return """
<!doctype html>
<html>
<meta charset=utf-8>
<title>Parley OAuth Redirect</title>
<body>
<script type="text/javascript">
window.close();
</script>
</body>
</html>
    """
  else:
    abort(403)

@app.route("/imap/get", methods=['GET'])
def imap_get():
  user = getUser(request.args["user"])
  if user and not user["pending"] and user["imap_account"] and 'sig' in request.args and verifySignature(request.base_url, request.method, request.args, user["secret"]):
    account_dict = json.loads(user["imap_account"])
    params = {'id':account_dict["id"]}
    account = contextio.Account(context_io, params)
    messages =  account.get_messages(include_body=1,body_type='text/plain',limit=50,offset=request.args["offset"])

    #filter out unencrypted mail, and create an array of serialized messages
    serialized_messages = []
    for message in messages:
      #if "-----BEGIN PGP MESSAGE-----" in message.body[0]["content"]:
      message_dict = {}
      for key in contextio.Message.keys:
        if key != 'files':
          message_dict[key] = getattr(message,key)
      message_dict['body'] = message.body
      serialized_messages.append(message_dict)
      #  serialized_messages.append(message_dict_)
    return jsonify(messages=serialized_messages)

  else:
    abort(403)


if __name__ == "__main__":
  app.run(debug=True,host='0.0.0.0')
