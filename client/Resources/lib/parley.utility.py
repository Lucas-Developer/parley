'''
These utilities are called from parley.utility.js, and deal with
crypto stuff and calls to PGP keyservers.
'''

import gnupg
import pbkdf2, aes
import base64, hmac, hashlib
from urllib import urlencode, quote_plus
import os, platform, subprocess, shutil
import time
try:
  import json
except ImportError:
  import simplejson as json

def platform_path(): #from parley_dir
  if 'Darwin' in platform.platform():
    return 'osx/bin/gpg'
  elif 'Windows' in platform.platform():
    return 'win32\gpg.exe'
  elif 'Linux' in platform.platform():
    return 'linux/bin/gpg'

def install_path(): # from parley_dir
  if 'Darwin' in platform.platform():
    return './osx-install.sh'
  elif 'Windows' in platform.platform():
    return None
  elif 'Linux' in platform.platform():
    return './linux-install.sh'

def PYinstalled(resource_dir,appdata_dir,home_dir):
  if 'Darwin' in platform.platform():
    appdata_dir = home_dir
  parley_dir = os.path.join(appdata_dir,'parley_gpg')
  gpg_dir = os.path.join(resource_dir,'gpg')
  if not os.path.isdir(parley_dir):
    shutil.copytree(gpg_dir,parley_dir)
  os.chdir(parley_dir)
  gpg_binary = platform_path()
  gpg_home = "keyring"
  if os.path.isfile(gpg_binary):
    global gpg
    gpg = gnupg.GPG(gpgbinary=gpg_binary,gnupghome=gpg_home)
    return True
  return False

def PYinstall(resource_dir,appdata_dir,home_dir):
  global gpg

  if 'Darwin' in platform.platform():
    appdata_dir = home_dir

  #copy Resources/gpg to application data dir
  gpg_dir = os.path.join(resource_dir,'gpg')
  parley_dir = os.path.join(appdata_dir,'parley_gpg')

  if not os.path.isdir(parley_dir):
    shutil.copytree(gpg_dir,parley_dir)

  os.chdir(parley_dir)



  gpg_binary = platform_path()
  gpg_home = "keyring"

  #if Tide's version of GPG isn't installed yet, install it
  #(This approach only works on Linux and Mac with gcc pre-installed))
  subprocess.call([install_path()])
  gpg = gnupg.GPG(gpgbinary=gpg_binary,gnupghome=gpg_home)

window.PYinstalled = PYinstalled
window.PYinstall = PYinstall


def PYgenKey(send_key = False):
  PYclearKeys()
  input_data = gpg.gen_key_input(
      key_type="RSA",
      key_length=2048,
      name_real=window.Parley.currentUser.attributes.name,
      name_comment="Generated by Parley",
      name_email=window.Parley.currentUser.attributes.email,
      expire_date=0,
      passphrase=window.Parley.currentUser.attributes.passwords.local)
  key_data = gpg.gen_key(input_data)
  if send_key:
    gpg.send_keys('pgp.mit.edu',key_data.fingerprint)
  return key_data

window.PYgenKey = PYgenKey


def PYgetEncryptedKeyring():
  public_keys = [key['keyid'] for key in gpg.list_keys()]
  private_keys = [key['keyid'] for key in gpg.list_keys(True)]
  keyring = dict(public=gpg.export_keys(public_keys),private=gpg.export_keys(private_keys,True))
  encrypted_keyring = aes.encryptData(window.Parley.currentUser.attributes.passwords.local[0:32],json.dumps(keyring))
  return base64.b64encode(encrypted_keyring)

window.PYgetEncryptedKeyring = PYgetEncryptedKeyring


def PYclearKeys():
  secret_fps = [key['fingerprint'] for key in gpg.list_keys(True)]
  fps = [key['fingerprint'] for key in gpg.list_keys()]
  for fp in secret_fps:
    gpg.delete_keys(fp, True)
  for fp in fps:
    gpg.delete_keys(fp)

window.PYclearKeys = PYclearKeys


def PYimportEncryptedKeyring(b64_keyring):
  PYclearKeys()
  encrypted_keyring = base64.b64decode(b64_keyring)
  keyring = json.loads(aes.decryptData(window.Parley.currentUser.attributes.passwords.local[0:32],encrypted_keyring))
  gpg.import_keys(keyring['private'])
  gpg.import_keys(keyring['public'])
  return True

window.PYimportEncryptedKeyring = PYimportEncryptedKeyring


def PYgetPublicKey():
  #assume that there is a single private key per user, and use that to
  #get the keyid for the pair
  private_key = gpg.list_keys(True)
  keyid = private_key[0]['keyid']
  public_key = gpg.export_keys(keyid)
  return public_key

window.PYgetPublicKey = PYgetPublicKey


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


def PYfetchKey(email):
  keys = gpg.search_keys("<%s>" % email)
  if keys.fingerprints == []:
    return None
  else:
    imported = gpg.recv_keys('pgp.mit.edu',keys.fingerprints[0])
    return imported.fingerprints[0]

window.PYfetchKey = PYfetchKey


def PYimportKey(key):
  return gpg.import_keys(key)

window.PYimportKey = PYimportKey


def PYlistKeys():
  return gpg.list_keys()

window.PYlistKeys = PYlistKeys


def PYencryptAndSign(data, recipients, signer, passphrase):
  #Because of the way Tide passes stuff around, recipients
  #doesn't seem to arrive as a legitimate Python list, but
  #it is an iterator. gpg.encrypt expects a nice list, so:
  rlist = [fp for fp in recipients]
  #TODO:implement trust levels, think about how/when accounts should sign each other's keys
  data = gpg.encrypt(data, rlist, sign=signer, passphrase=passphrase, always_trust=True)
  window.console.log(data)
  return data.data

window.PYencryptAndSign = PYencryptAndSign


def PYdecryptAndVerify(data, passphrase, sender_id):
  #TODO:implement WoT validation
  decrypted_data =  gpg.decrypt(data, passphrase=passphrase, always_trust=True)
  window.console.log(decrypted_data)
  #if decrypted_data.fingerprint == sender_id:
  if decrypted_data.data:
    return decrypted_data.data
  else:
    return "Parley Exception: Unable to decrypt this message with information given."

window.PYdecryptAndVerify = PYdecryptAndVerify


def PYchangePass(newPass):
  oldPass = window.Parley.currentUser.attributes.passwords.local
  private_key = gpg.list_keys(True)
  keyid = private_key[0]['fingerprint']
  return gpg.change_pass(keyid,oldPass,newPass)

window.PYchangePass = PYchangePass


def PYrevokeKey():
  private_key = gpg.list_keys(True)
  keyid = private_key[0]['fingerprint']
  revocation  = gpg.gen_revoke(keyid,window.Parley.currentUser.attributes.passwords.local)
  gpg.import_keys(revocation)
  return gpg.send_keys('pgp.mit.edu',keyid)

window.PYrevokeKey = PYrevokeKey

def PYchangeName(newName):
  oldEmail = window.Parley.currentUser.attributes.email
  private_key = gpg.list_keys(True)
  fp = private_key[0]['fingerprint']
  return gpg.add_uid(fp,newName,oldEmail,'Generated by Parley',window.Parley.currentUser.attributes.passwords.local)

window.PYchangeName = PYchangeName
