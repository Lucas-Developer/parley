'''
These utilities are called from parley.utility.js, and deal with
crypto stuff and calls to PGP keyservers.
'''

import gnupg
import pbkdf2
import base64, hmac, hashlib
from urllib import urlencode, quote_plus
import os, platform, subprocess, zipfile
from io import StringIO


resource_dir = window.Ti.Filesystem.getResourcesDirectory().toString()
os.chdir(resource_dir)

def platform_path():
  if 'Darwin' in platform.platform():
    return 'osx/bin/gpg'
  elif 'Windows' in platform.platform():
    return 'win32\gpg.exe'
  elif 'Linux' in platform.platform():
    return 'linux/bin/gpg'

gpg_binary = os.path.join("gpg", platform_path())
gpg_home = os.path.join("gpg","keyring")

#if Tide's version of GPG isn't installed yet, install it
#(This approach only works on Linux and Mac with gcc pre-installed))
if not os.path.isfile(gpg_binary):
  #TODO: make this cross-platform (windows is fine, pre-compiled bins)
  subprocess.call(['gpg/osx-install.sh'])

gpg = gnupg.GPG(gpgbinary=gpg_binary,gnupghome=gpg_home)


def PYgenKey():
  return gpg.gen_key_input(
      key_type="RSA",
      key_length=2048,
      name_real=window.Parley.currentUser.attributes.name,
      name_comment="Generated by Parley",
      name_email=window.Parley.currentUser.attributes.email,
      expire_date=0,
      passphrase=window.Parley.currentUser.attributes.passwords.local)

window.PYgenKey = PYgenKey


def PYgetZippedKeyring():
  zip = zipfile.ZipFile('keyring.zip','w')
  for root, dirs, files in os.walk(gpg_home):
    for file in files:
      zip.write(os.path.join(root, file))
  zip.close()
  with open("keyring.zip", "rb") as zipped_keyring:
    b64_keyring = base64.b64encode(zipped_keyring.read())
  return b64_keyring

window.PYgetZippedKeyring = PYgetZippedKeyring


def PYunpackKeyring(b64_keyring):
  zipped_keyring = StringIO.StringIO(base64.b64decode(b64_keyring))
  zip = zipfile.ZipFile(zipped_keyring)

  #http://stackoverflow.com/questions/7806563/how-to-unzip-a-file-with-python-2-4
  for name in zip.namelist():
    (dirname, filename) = os.path.split(name)
    if not os.path.exists(dirname):
      os.mkdir(dirname)
    fd = open(name,"w")
    fd.write(zfile.read(name))
    fd.close()

window.PYunpackKeyring = PYunpackKeyring


def PYsignAPIRequest(url, method, data):
  keys = window.Object.keys(data)
  keys.sort()
  values = [data[key] for key in keys]
  url_string = urlencode(zip(keys,values))
  sig = hmac.new(
      key=window.Parley.currentUser.attributes.passwords.remote,
      msg=method+'|'+url+'?'+url_string,
      digestmod=hashlib.sha256).digest()
  sig = quote_plus(base64.encodestring(sig).strip())
  return sig

window.PYsignAPIRequest = PYsignAPIRequest


def PYpbkdf2(data):
  salt = window.Parley.currentUser.attributes.email + '10620cd1fe3b07d0a0c067934c1496593e75994a26d6441b835635d98fda90db'
  return pbkdf2.pbkdf2_hex(data, salt, 2048, 32)

window.PYpbkdf2 = PYpbkdf2


def PYimportKey(email):
  keys = gpg.search_keys("<%s>" % email)
  if keys == []:
    return None
  else:
    imported = gpg.recv_keys('pgp.mit.edu',keys[0]['keyid'])
    return imported.fingerprints[0]

window.PYimportKey = PYimportKey


def PYlistKeys():
  return gpg.list_keys()

window.PYlistKeys = PYlistKeys


def PYencryptAndSign(data, recipients, signer, passphrase):
  data = gpg.encrypt(data, recipients, sign=signer, passphrase=passphrase)
  return data.data

window.PYencryptAndSign = PYencryptAndSign


def PYdecryptAndVerify(data, passphrase, sender_id):
  decrypted_data =  gpg.decrypt(data, passphrase=passphrase)
  if decrypted_data.key_id == sender_id or decrypted_data.fingerprint == sender_id:
    return decrypted_data.data
  else:
    return "Parley Exception: The signature on this message was no good."

window.PYdecryptAndVerify = PYdecryptAndVerify

