(function(Parley, $, undefined){
    Parley._initialDialogs = [
        {   id: 'dialog_setup',
            template: Mustache.compile($('#setupDialogTemplate').html()),
            events: {
                'click #emailVerify': function (e) {
                    e.preventDefault();
                    var form = document.forms.emailVerify;

                    if (form.email.value.length == 0 || !Parley.rex.email.test(form.email.value)) {
                        Parley.formErrors('emailVerify', { email: _t('error-email-novalid') });
                        return false;
                    }

                    formdata = { email: form.email.value };
                    Parley.vent.trigger('setup:verify', formdata);
                },
                'click #loginAction': function (e) {
                    e.preventDefault();
                    var form = document.forms.loginAction;

                    if (form.password.value.length == 0) {
                        Parley.formErrors('loginAction', { password: _t('error-password-novalid') });
                        return false;
                    }

                    formdata = {
                        email: form.email.value,
                        password: form.password.value
                    }
                    Parley.vent.trigger('setup:login', formdata);
                },
                'click .setupBackButton': function (e) {
                    Parley.app.dialog('setup splash');
                },
                'click #registerAction': function (e) {
                    e.preventDefault();
                    var form = document.forms.registerAction,
                        formdata;

                    if (form.password_one.value != form.password_two.value) {
                        console.log('Passwords don\'t match.');
                        Parley.formErrors('registerAction', { password_two: _t('password mismatch') });
                        return false;
                    }

                    if (_.isUndefined(form.email.value) || !Parley.rex.email.test(form.email.value)) {
                        Parley.formErrors('registerAction', { email: _t('error-email-novalid') });
                        return false;
                    }

                    formdata = {
                        password: form.password_two.value,
                        name: form.name.value,
                        email: form.email.value,
                        send_key: form.send_key.checked
                    };
                    Parley.vent.trigger('setup:register', formdata);
                },
                'click #importKeyDialogAction': function (e) {
                    e.preventDefault();
                    Parley.app.dialog('show info importkey', {
                        header: _t('import key'),
                        message: _t('message-import-key'),
                        extra_html: '<textarea name="key" rows="6"></textarea>',
                        buttons: [
                            {
                                id: "importKeyAction",
                                text: _t('import key'),
                                handler: function (e) {
                                    var key = $('#importKeyField').val();
                                    /*
                                    // Import secret key and close dialog.
                                    Parley.importSecretKey(key, function () {
                                        Parley.app.dialog('hide info importkey');
                                    });
                                    */
                                }
                            },
                            'cancel'
                        ]
                    });
                }
            },
            model: {
                slug: 'setup',
                opts: { dialogClass: 'no-close' },
                title: 'Welcome to Parley'
            },
        },
        {   
            id: 'dialog_settings',
            template: Mustache.compile($('#settingsDialogTemplate').html()),
            events: {
                'click #saveSettingsAction': function (e) {
                    e.preventDefault();
                    var form = document.forms.settings;
                    var formdata = {
                        name: form.name.value,
                        auto_refresh: form.auto_refresh.checked
                    };

                    if (!formdata.name) {
                        Parley.formErrors('settings', { name: _t('error-settings-invalidname') });
                        return false;
                    }
                    
                    Parley.saveUser(formdata, function (data) {
                        if (!_.has(data, 'error')) {
                            var parsed_data = Parley.falseIsFalse(data);

                            Parley.currentUser.set(parsed_data);

                            Parley.app.dialog('show info settings-saved', {
                                header: _t('success'),
                                message: _t('message-settings-saved'),
                                buttons: [ 'okay' ]
                            });
                        } else {
                            Parley.app.dialog('show info settings-saveerror', {
                                header: _t('error'),
                                message: _t('message-settings-saveerror') + "\n" + data.error,
                                buttons: [ 'okay' ]
                            });
                        }
                    });
                },
                'click #changePasswordAction': function (e) {
                    console.log('Changing password');

                    Parley.pauseTimer = true;
                    e.preventDefault();

                    var form = document.forms.changePassword;

                    if (!form.cur_password.value) {
                        return Parley.formErrors('changePassword', { cur_password: _t('error-settings-invalidpassword') }) && false;
                    }

                    if (!form.new_password_1.value) {
                        return Parley.formErrors('changePassword', { new_password_1: _t('error-settings-invalidpassword') }) && false;
                    }

                    if (form.new_password_1.value != form.new_password_2.value) {
                        return Parley.formErrors('changePassword', {
                            new_password_1: _t('password mismatch'),
                            new_password_2: _t('password mismatch')
                        }) && false;
                    }

                    Parley.changePass(form.cur_password.value, form.new_password_2.value, function (data, status) {
                        Parley.pauseTimer = false;

                        if (!_.has(data, 'error')) {
                            Parley.app.dialog('show info password-changed', {
                                header: _t('password changed'),
                                message: _t('message-password-changed'),
                                buttons: [ 'okay' ]
                            });
                        } else {
                            Parley.app.dialog('show info password-changeerror', {
                                header: _t('error'),
                                message: _t('message-password-changeerror') + "\n" + data.error,
                                buttons: [ 'okay' ]
                            });
                        }
                    });
                },
                'click #revokeKeyAction': function (e) {
                    e.preventDefault();
                    Parley.vent.trigger('user:kill');
                },
                'click #reconnectInboxAction': function (e) {
                    e.preventDefault();

                    Parley.registerInbox();
                    Parley.waitForRegisteredInbox(function(success) {
                        Parley.app.dialog('hide info inbox-error');
                        _.delay(function(){Parley.vent.trigger('message:sync');},1000);
                    });
                }
            },
            model: {
                slug: 'settings',
                title: 'Parley Settings'
            }
        },
        {   id: 'dialog_contacts',
            template: Mustache.compile($('#contactsDialogTemplate').html()),
            events: {
                'click .send': function (e) {
                    e.preventDefault();
                    var from_obj = Parley.contacts.findWhere({email: $(e.target).data('email')});
                    Parley.app.dialog('compose', {from: from_obj});
                },
                'click #newContact': function (e) { e.preventDefault(); Parley.app.dialog('contacts newcontact'); },
                'click #backToContactlist': function (e) { e.preventDefault(); Parley.app.dialog('contacts contactlist'); },
                'click #addContact': function (e) {
                    e.preventDefault();
                    var formdata = this.$('form[name=newcontact]').serializeArray();
                    var email = _.findWhere(formdata, {name:'email'});
                    Parley.contacts.add({email: email.value});
                    Parley.app.dialog('contacts contactlist');
                }
            },
            model: {
                slug: 'contacts',
                title: 'Contacts',
                opts: { minHeight: 400, minWidth: 650, resizable: false },
                init: function () {
                    this.contacts = Parley.contacts.toJSON();
                },
                loaded: function (view) {
                    view.$('#contactsList').replaceWith(Parley.app.contactsList);
                }
            }
        },
        {   id: 'dialog_nokey',
            template: Mustache.compile($('#nokeyDialogTemplate').html()),
            events: {
                'click #inviteAction': function (e) {
                    e.preventDefault();
                    var emails = [], selected = $('#nokeysForm input:checked');

                    selected.each(function (e) {
                        emails.push(this.name.split('_')[1]);
                    });

                    Parley.vent.trigger('invite', emails, function () {
                        Parley.app.dialog('hide nokey');
                        
                    });
                }
            },
            model: {
                slug: 'nokey',
                opts: {},
                title: 'Public PGP keys not found.'
            }
        },
        {   
            id: 'dialog_compose',
            template: Mustache.compile($('#composeDialogTemplate').html()),
            events: {
                'click #sendAction': function (e) {
                    e.preventDefault();

                    var formdata = $('#composeForm').serializeArray()

                    var recipient, recipients = [], nokeyRecipients = [], errors = {};
                    var to = _.findWhere(formdata, {name:'as_values_to'}),
                        subject = _.findWhere(formdata, {name:'subject'}),
                        body = _.findWhere(formdata, {name:'body'});
     
                    _.each(to.value.split(','), function (ele, i) {
                        if (recipient = Parley.contacts.findWhere({email:ele}))
                            recipients.push(recipient);
                        else if (Parley.rex.email.test(ele))
                            nokeyRecipients.push({email:ele});
                    });

                    if (_.isEmpty(recipients) && _.isEmpty(nokeyRecipients)) {
                        errors.as_values_to = _t('error-email-novalid');
                    }

                    // Other validation here. Just add elements to 'errors' array.

                    var messagedata = {
                        subject: subject.value,
                        body: body.value,
                        recipients: recipients
                    };

                    if (!_.isEmpty(errors)) {
                        Parley.formErrors('compose', errors);
                        return false;
                    }

                    if (nokeyRecipients.length == 0)
                        Parley.vent.trigger('message:send', messagedata);
                    else
                        Parley.vent.trigger('message:nokey', { message: messagedata, nokeys: nokeyRecipients });
                }
            },
            model: {
                slug: 'compose',
                opts: {},
                title: 'Compose',
                init: function () {
                    var respondTo = this.reply_to ? this.reply_to.toJSON() : this.from ? this.from.toJSON() : undefined;
                    this.to = [respondTo];

                    if (this.replyAll) {
                        _.each(this.addresses.to, _.bind(function (ele) {
                            var _tmp;
                                
                            if (ele.email == Parley.currentUser.get('email')) return false;

                            if (_tmp = Parley.contacts.findWhere({email: ele.email}))
                                this.to.push(_tmp);
                        }, this));
                    }

                    if (this.subject) {
                        var prefix = /^(R|r)e:/g;
                        this.subject = prefix.test(this.subject) ? this.subject : 're: ' + this.subject;
                    }

                    return this;
                },
                loaded: function (view) {
                    var items = Parley.contacts.map(function (ele,i) {
                        var email = ele.get('email');
                        var name = ele.get('name') || email;

                        return {name: name, value: email, uid: name + ' <' + email + '>'}
                    });

                    if (_.isArray(this.to) && !!this.to[0]) {
                        preFill = _.map(this.to, function (ele) {
                            return _.findWhere(items, {value: ele.get ? ele.get('email') : ele.email}) || {};
                        });
                    } else {
                        preFill = {};
                    }

                    var opts = {
                        selectedItemProp: 'name',
                        searchObjProps: 'name,value',
                        preFill: preFill
                    };

                    view.$('#recipient_to').each(function (){
                        $(this).autoSuggest(items, _.extend({asHtmlID: this.name}, opts));
                    });
                }
            }
        }
    ];

    Parley.inboxPerPage = 50;
    Parley.inboxCurPage = 1;
    Parley.inboxCurOffset = 0;

    Parley.rex = {
        email: /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/
    };

    Parley.alarms = [
        {
            when: function () { return true; },
            todo: function () { console.log('TICK'); }
        },
        {
            when: function () { return Parley.currentUser && Parley.currentUser.get('auto_refresh'); },
            todo: function () { Parley.vent.trigger('message:sync'); }
        }
    ]
}(window.Parley = window.Parley || {}, jQuery));
