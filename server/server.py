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
import random, string
from urllib import urlencode, quote_plus, unquote
import time
import psycopg2
import psycopg2.extras
from itertools import izip

app = Flask(__name__)
if app.debug is not True:
  import logging
  from logging.handlers import RotatingFileHandler
  file_handler = RotatingFileHandler('python.log', maxBytes=1024 * 1024 * 100, backupCount=20)
  file_handler.setLevel(logging.DEBUG)
  app.logger.addHandler(file_handler)

config = dict()
with open('config.json') as config_file:
  config = json.load(config_file)

BASE_URL = "https://api.parley.co"

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
  new_sig = base64.b64encode(new_sig,'-_').strip('=')
  return compare_hashes(old_sig, new_sig) and t < 30

def getUser(email):
  cur.execute("SELECT * FROM users WHERE email=%s",[email])
  try:
    u = cur.fetchone()
  except ProgrammingError:
    u = None
  if u and 'email' in u:
    return u
  else:
    return None

#the usage for this is to pass an info dictionary along with the
#email which acts as database key
#the info dict can have anything in it--if the key of the dict
#is a field on the users table, it will get inserted there.
#otherwise, it gets merged into the "meta" json object (stored as text)
def setUser(email,info):
  info["email"] = email

  user = getUser(email)
  if user:
    #merge info with existing stuff
    user_meta = json.loads(user['meta'])
    meta = dict(user_meta.items() + user.items() + info.items())
    if 'meta' in meta:
      del meta['meta']
  else:
    meta = info

  #extract separated fields from meta
  fields = dict()
  for key in ["name","secret","keyring","public_key","pending","email","account_type","imap_account","paid_invites"]:
    if key in meta:
      fields[key] = meta[key]
      del meta[key]
    else:
      fields[key] = None

  meta_json = json.dumps(meta)

  if user:
    cur.execute("UPDATE users SET name=%s, secret=%s, keyring=%s, public_key=%s, pending=%s, account_type=%s, imap_account=%s, paid_invites=%s, meta=%s WHERE email=%s",[fields["name"], fields["secret"], fields["keyring"], fields["public_key"], fields["pending"], fields["account_type"], fields["imap_account"], fields["paid_invites"], meta_json, fields["email"]])
  else:
    cur.execute("INSERT INTO users (name,email,secret,keyring,public_key,pending,account_type,imap_account,paid_invites,meta) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",[fields["name"],fields["email"],fields["secret"],fields["keyring"],fields["public_key"],fields["pending"],fields["account_type"],fields["imap_account"],fields["paid_invites"],meta_json])
  conn.commit()
  return getUser(email)

def deleteUser(email):
  cur.execute("DELETE FROM users WHERE email=%s",[email])
  conn.commit()
  return {"success":True} #TODO: this should be more informative


def get_header_params(headers, email):
  params = {}
  if 'Authorization' in headers and 'Sig-Time' in headers:
    pair = headers['Authorization'].split()[-1]
    pieces = pair.split(':')
    authemail = ':'.join(pieces[:-1])
    if authemail == email:
      params['sig'] = pieces[-1]
      params['time'] = headers['Sig-Time']
  return params


@app.route("/u/<email>", methods=['GET','POST','DELETE'])
def user(email):
  email = unquote(email) 
  user = getUser(email)
  params = get_header_params(request.headers, email)
  if request.method == 'GET':
    params.update(request.args.to_dict())
    if user and not user["pending"] and 'sig' in params and verifySignature(request.base_url, request.method, params, user["secret"]):
      #authenticated. return all info
      return jsonify(**user), 200
    elif user and not user["pending"]:
      #only return public info
      return jsonify(name=user["name"], email=user["email"], public_key=user["public_key"]), 200
    else:
      abort(404)
  elif request.method == 'POST':
    params.update(request.form.to_dict())
    if user and not user["pending"] and 'keyring' in params and 'sig' in request.form and verifySignature(request.base_url, request.method, request.form, user["secret"]):
      #update active user
      new_user = {}
      for key in ["keyring","public_key","secret"]:
        if key in params:
          new_user[key] = params[key]
      user = setUser(email,new_user)
      return jsonify(**user), 201
    elif user and user["pending"] and 'p' in params:
      #activate pending user
      meta = json.loads(user['meta'])
      if 'verified' in meta and meta['verified'] == True:
        new_user = {"pending":False,"secret":params['p']}
        for key in ["name","public_key","keyring"]:
          if key in params:
            new_user[key] = params[key]
        user = setUser(email,new_user)
        return jsonify(**user), 201
      else:
        abort(403)
  elif request.method == 'DELETE':
    if user and not user["pending"] and 'sig' in params and verifySignature(request.base_url, request.method, params, user["secret"]):
      resp = deleteUser(email)
      return jsonify(**resp), 200 #TODO: use proper HTTP code
  abort(400)
    

@app.route("/purchase/<email>", methods=['POST'])
def purchase(email):
  email = unquote(email)
  params = get_header_params(request.headers, email)
  params.update(request.form.to_dict())
  if params['user'] == 'PARLEY.CO' and compare_hashes(request.form["sig"], config["parley_website_key"]):
    user = setUser(
        email,
        {
          "account_type":2,
          "customer_id":params["customer_id"]
        }
        )
    return jsonify({'email':user['email']}), 201
  else:
    abort(403)


@app.route("/verify/<email>", methods=['POST'])
def verify(email):
  email = unquote(email)
  user = getUser(email)
  params = get_header_params(request.headers, email)
  params.update(request.form.to_dict())
  meta = json.loads(user['meta'])
  if user and user['pending'] and not 'verified' in meta:
    if compare_hashes(params['token'], meta['verification_token']):
      user = setUser(email,{'verified':True})
      return jsonify(**user), 201
    else:
      abort(403)
  else:
    abort(400)
 

@app.route("/invite/<to>", methods=['POST'])
def invite(to):
  to = unquote(to)
  #TODO: implement paid invites!
  to_user = getUser(to)
  params = get_header_params(request.headers, request.form['user'])
  params.update(request.form.to_dict())

  # if this is the result of a registration from the website
  if params["user"] == 'PARLEY.CO' and 'sig' in request.form:
    if compare_hashes(params["sig"], config["parley_website_key"]):
      token = ''.join(random.choice(string.ascii_lowercase+string.digits) for x in range(20))
      if 'customer_id' in params:
        if to_user:
          meta = json.loads(to_user['meta'])
          token = meta['verification_token']
          if "verified" in meta:
            abort(400)
        to_user = setUser(
            to,
            {
              "pending":True,
              "account_type":2,
              "invited_by":"PARLEY.CO",
              "verification_token":token,
              "customer_id":params['customer_id']
            }
            )
        message = {"from": "Dave Noel <dave@blackchair.net>",
            "to": [to_user["email"]],
            "subject": "Parley.co Email Verification",
            "text": """Hello, and thanks for checking out Parley! Extra thanks for choosing to pre-purchase a paid account--your money will help us move forward more quickly, and your vote of confidence means the world to us. Please take Parley for a spin, tell your friends, and send us any feedback you might have--you can either reply to this email directly or reach me at dave@blackchair.net. (My company, Black Chair Studios, is the one building Parley.)

Your email verification link is here: https://parley.co/verify?user=%s&token=%s There will be instructions on that page for downloading the Parley app, but for your future reference the regular download link is here: https://parley.co/downloads (You won't be able to use the app without verifying your email address first.)

Like I said above, please please please let me know if you have any questions or comments at all; I will be more than happy to hear from you.

All the best,

Dave Noel
Co-Founder
Black Chair Studios, Inc.
www.blackchair.net
            """ % (quote_plus(to), token)}
      else:
        if to_user:
          meta = json.loads(to_user['meta'])
          token = meta['verification_token']
          if "verified" in meta:
            abort(400)
        else:
          to_user = setUser(
              to,
              {
                "pending":True,
                "account_type":0,
                "invited_by":"PARLEY.CO",
                "verification_token":token
              }
              )
        message = {"from": "Dave Noel <dave@blackchair.net>",
            "to": [to_user["email"]],
            "subject": "Parley.co Email Verification",
            "text": """Hello, and thanks for checking out Parley!

We're really glad you decided to try out our pre-beta. Please take it for a spin, tell your friends, and send us any feedback you might have--you can either reply to this email directly or reach me at dave@blackchair.net. (My company, Black Chair Studios, is the one building Parley.)

Your email verification link is here: https://parley.co/verify?user=%s&token=%s There will be instructions on that page for downloading the Parley app, but for your future reference the regular download link is here: https://parley.co/downloads (You won't be able to use the app without verifying your email address first.)

Like I said above, please please please let me know if you have any questions or comments at all; I will be more than happy to hear from you.

All the best,

Dave Noel
Co-Founder
Black Chair Studios, Inc.
www.blackchair.net
            """ % (quote_plus(to), token)}
      response = HTTP.post(
          "https://api.mailgun.net/v2/parley.co/messages",
          auth=("api", MAILGUN_API_KEY),
          data=message)
      response_dict = response.json()
      return jsonify(**response_dict), 201


  #otherwise, this is a user-to-user invite
  from_user = getUser(params["user"])

  '''
  paid_invites = from_user["paid_invites"] or 0
  if not paid_invites and 'sig' in params:
    paid_invites = -1 #if the user is trying to send a paid invite but has none

  #TODO: modify the following if/else to accomodate for the situation where someone is trying to send a paid invite to an already pending user--if the account type is better than their current invite, it should send the new one. either way it should send a reminder
  if from_user and not from_user["pending"] and 'sig' in params and verifySignature(request.base_url, request.method, request.form, from_user["secret"]) and not to_user and paid_invites > 0:
    new_user = setUser(
        to,
        {
          "pending":True,
          "account_type":from_user["account_type"],
          "invited_by":from_user["email"],
          "verification_token":token
        }
        )
    #TODO: SEND PAID INVITE
    paid_invites = paid_invites - 1
    setUser(from_user["email"],{"paid_invites":paid_invites})
  elif not to_user: # if "to" is not already a user or pending user
  '''
  if not to_user: # if "to" is not already a user or pending user
    token = ''.join(random.choice(string.ascii_lowercase+string.digits) for x in range(20))
    new_user = setUser(
        to,
        {
          "pending":True,
          "account_type":0,
          "invited_by":from_user["email"],
          "verification_token":token
        }
        )
    #create invite message
    message = {"from": "%s <%s>" % (from_user['name'], from_user['email']),
        "to": [new_user["email"]],
        "subject": "I want to exchange encrypted mail with you via Parley.co",
        "text": """Hey,

I generated this invitation for you so that we can exchange encrypted email easily using the Parley app: https://parley.co/verify?user=%s&token=%s

Hope to hear from you soon,
%s
        """ % (quote_plus(new_user["email"]), token, from_user['name'])}

  elif to_user and to_user["pending"]:
    #create reminder message
    meta = json.loads(to_user['meta'])
    token = meta['verification_token']
    message = {"from": "%s <%s>" % (from_user['name'], from_user['email']),
        "to": [to_user["email"]],
        "subject": "Another invitation to Parley.co",
        "text": """Hey,

I generated this reminder for you to sign up for Parley so that we can exchange encrypted emails: https://parley.co/verify?user=%s&token=%s

Talk soon,
%s
        """ % (quote_plus(to_user["email"]), token, from_user['name'])}

  #return jsonify(paidInvitesRemaining=paid_invites), 200
  response = HTTP.post(
      "https://api.mailgun.net/v2/parley.co/messages",
      auth=("api", MAILGUN_API_KEY),
      data=message)
  response_dict = response.json()
  return jsonify(**response_dict), 201


#---- MAILGUN STUFF ----#
MAILGUN_API_KEY = config["mailgun_api_key"]

@app.route("/smtp/send", methods=['POST'])
def smtp_send():
  user = getUser(request.form["user"])
  params = get_header_params(request.headers, request.form['user'])
  params.update(request.form.to_dict())
  if user and not user["pending"] and 'sig' in params and verifySignature(request.base_url, request.method, request.form, user["secret"]):
    message = json.loads(params['message'])
    message['from'] = "%s <%s>" % (user["name"], user["email"])
    response = HTTP.post(
        "https://api.mailgun.net/v2/parley.co/messages",
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
  email = unquote(email)
  user = getUser(email)
  params = get_header_params(request.headers, email)
  params.update(request.args.to_dict())
  if user and not user["pending"] and 'sig' in params and verifySignature(request.base_url, request.method, params, user["secret"]):
    time = params["time"]
    sig = hmac.new(
        key=config["contextio_api_secret"]+user["secret"],
        msg=email+'|'+time,
        digestmod=hashlib.sha256).digest()
    sig = base64.b64encode(sig,'-_').strip('=')
    resp = context_io.post_connect_token(
        callback_url="%s/imap/new/%s/%s/%s" % (BASE_URL, quote_plus(email), time, sig),
        email=email
        )
    return jsonify(**resp), 200
  else:
    abort(403)

@app.route("/imap/new/<email>/<timestamp>/<sig>", methods=['GET'])
def imap_new(email, timestamp, sig):
  email = unquote(email)
  user = getUser(email)
  sig = quote_plus(sig)
  t = abs(time.time() - int(timestamp))
  new_sig = hmac.new(
        key=config["contextio_api_secret"]+user["secret"],
        msg=email+'|'+timestamp,
        digestmod=hashlib.sha256).digest()
  new_sig = base64.b64encode(new_sig,'-_').strip('=')
  if compare_hashes(sig, new_sig) and t < 30*60:
    cio_params = {'token':request.args['contextio_token']}
    token = contextio.ConnectToken(context_io,cio_params)
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
  params = get_header_params(request.headers, request.args['user'])
  params.update(request.args.to_dict())
  if user and not user["pending"] and user["imap_account"] and 'sig' in params and verifySignature(request.base_url, request.method, params, user["secret"]):
    account_dict = json.loads(user["imap_account"])
    cio_params = {'id':account_dict["id"]}
    account = contextio.Account(context_io, cio_params)
    messages =  account.get_messages(include_body=1,body_type='text/plain',limit=100,offset=params["offset"])

    #filter out unencrypted mail, and create an array of serialized messages
    serialized_messages = []
    for message in messages:
      try:
        if "-----BEGIN PGP MESSAGE-----" in message.body[0]["content"]:
          message_dict = {}
          for key in contextio.Message.keys:
            if key != 'files':
              message_dict[key] = getattr(message,key)
          message_dict['body'] = message.body
          serialized_messages.append(message_dict)
      except:
        pass
    return jsonify(messages=serialized_messages)

  else:
    abort(403)


if __name__ == "__main__":
  app.run()
