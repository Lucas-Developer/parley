'''
This is now just a shim for testing until we get node-webkit working.
'''

import pbkdf2
import base64, hmac, hashlib
from urllib import urlencode, quote_plus
import os, platform, subprocess, shutil
import time
import json

def PYsignAPIRequest(url, method, data):
  keys = window.Object.keys(data)
  keys.sort()
  values = [getattr(data,key) for key in keys]
  url_string = urlencode(zip(keys,values))
  sig = hmac.new(
      key=window.Parley.currentUser.attributes.passwords.remote,
      msg=method+'|'+url+'?'+url_string,
      digestmod=hashlib.sha256).digest()
  sig = base64.b64encode(sig,'-_').strip('=')
  return sig

window.PYsignAPIRequest = PYsignAPIRequest


def PYpbkdf2(data):
  salt = window.Parley.currentUser.attributes.email + '10620cd1fe3b07d0a0c067934c1496593e75994a26d6441b835635d98fda90db'
  return pbkdf2.pbkdf2_hex(data, salt.lower(), 2048, 32)

window.PYpbkdf2 = PYpbkdf2


