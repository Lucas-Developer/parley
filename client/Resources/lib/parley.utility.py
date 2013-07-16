'''
These utilities are called from parley.utility.js, and deal with
crypto stuff and calls to PGP keyservers.
'''

import gnupg
import pbkdf2, aes
import base64, hmac, hashlib
from urllib import urlencode, quote_plus
import os, platform, subprocess


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
  input_data = gpg.gen_key_input(
      key_type="RSA",
      key_length=2048,
      name_real=window.Parley.currentUser.attributes.name,
      name_comment="Generated by Parley",
      name_email=window.Parley.currentUser.attributes.email,
      expire_date=0,
      passphrase=window.Parley.currentUser.attributes.passwords.local)
  key_data = gpg.gen_key(input_data)
  gpg.send_keys('pgp.mit.edu',key_data.fingerprint)
  return key_data

window.PYgenKey = PYgenKey


def PYgetEncryptedKeyring():
  keyring = dict(public=gpg.export_keys(),private=gpg.export_keys(True))
  encrypted_keyring = aes.encryptData(window.Parley.currentUser.attributes.passwords.local[0:32],json.dumps(keyring))
  return base64.b64encode(encrypted_keyring)

window.PYgetEncryptedKeyring = PYgetEncryptedKeyring


def PYimportEncryptedKeyring(b64_keyring):
  encrypted_keyring = base64.b64decode(b64_keyring)
  keyring = json.loads(aes.decryptData(window.Parley.currentUser.attributes.passwords.local[0:32],encrypted_keyring))
  gpg.import_keys(keyring['private'])
  gpg.import_keys(keyring['public'])
  return True

window.PYimportEncryptedKeyring = PYimportEncryptedKeyring


def PYsignAPIRequest(url, method, data):
  keys = window.Object.keys(data)
  keys.sort()
  values = [getattr(data,key) for key in keys]
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
  data = gpg.encrypt(data, recipients, sign=signer, passphrase=passphrase, always_trust=True)
  return data.data

window.PYencryptAndSign = PYencryptAndSign


def PYdecryptAndVerify(data, passphrase, sender_id):
  decrypted_data =  gpg.decrypt(data, passphrase=passphrase)
  if decrypted_data.key_id == sender_id or decrypted_data.fingerprint == sender_id:
    return decrypted_data.data
  else:
    return "Parley Exception: The signature on this message was no good."

window.PYdecryptAndVerify = PYdecryptAndVerify

