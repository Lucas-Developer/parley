(function(Parley, $, undefined){
    Parley.vent = Parley.vent || _.extend({}, Backbone.Events);

    Parley.rex = {
        email: /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/g
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

    Parley.timerDelay = /* 5 minutes, for now */ 300000;
    Parley.timer = function () {
        _.each(Parley.alarms, function (alarm) {
            if (alarm.when()) alarm.todo();
        });

        window.setTimeout(Parley.timer, Parley.timerDelay);
    }

    Parley.falseIsFalse = function (data) {
        console.log('\'false\' is false');
        
        var parsed_data = {};

        _.each(data, function (v,k) {
            if (v == 'false')
                v = false;

            if (k=='meta')
                _.each(JSON.parse(v), function (v,k) {
                    if (v == 'false')
                        v = false;
                    parsed_data[k] = v;
                });
            else
                parsed_data[k] = v;
        });

        return parsed_data;
    };

    Parley.formErrors = function (fname, errors) {
        if (!_.isObject(errors) || !document.forms[fname]) return false;

        var form = $(document.forms[fname]), err, errSpan;
        _.each(form.find('input'), function (v) {
            errSpan = $(v).parents('label').find('.error');
            if (err = errors[v.name]) {
                errSpan.text(err);
            } else {
                errSpan.text('');
            }
        });
    }

	Parley.Contact = Backbone.Model.extend({
	    defaults: function () {
			return {
				last_received: 0,
				last_sent: 0,
				thumbnail: false,
				count: 0,
                email: '',
                fingerprint: '',
                messages: []
			}
	    },
        initialize: function (attrs) {
            console.log('Initializing contact.');

            if (attrs && !_.has(attrs, 'isCurrentUser'))
                Parley.vent.trigger('contact:userinfo', {
                    contact: this,
                    callback: function (contact) {
                        if (!_.has(data, 'error')) {
                            var data = contact.toJSON && contact.toJSON();
                            if (!Parley.contacts.findWhere({email: data.email})) {
                                Parley.contacts.add(contact);
                                Parley.storeKeyring(console.log);
                            }
                        } else {
                            console.log(data.error);
                        }
                    }
                });
/*
        },
        get: function (attr) {
            if (!_.has(this.attributes, attr) && _.has(this.attributes, 'meta'))
                return JSON.parse(this.attributes.meta)[attr];
            else
                return this.attributes[attr];
*/
        }
	});

	var ContactList = Backbone.Collection.extend({
	    model: Parley.Contact
	});
	var ContactView = Backbone.View.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#contactTemplate').html()),
        initialize: function () {
            this.listenTo(this.model, 'change', this.render);
        },
		render: function () {
			var data = this.model.toJSON();
			this.$el.addClass('contact').html(this.template(data));

			return this;
        }
	});

	Parley.Message = Backbone.Model.extend({
        defaults: function () {
            return {
                from: {},
                subject: '',
                selected: false
            };
        },
        idAttribute: 'message_id',
        initialize: function () {
            var data = this.toJSON();

            var from = data.addresses.from;
            var from_obj = Parley.contacts.findWhere({email: from.email});

            if (!from_obj) {
                console.log('Creating contact from scratch.');

                from_obj = new Parley.Contact(from);
            }

            if (_.has(data.person_info, from.email)) from_obj.set('thumbnail', data.person_info[from.email].thumbnail);

            this.set('from', from_obj);

            this.set('formattedDate', moment(data.date * 1000).fromNow());

            // If it's not encrypted, we can just populate the decrypted message array
            this.decryptedMessage = this.decryptedMessage || [];
        },
        readMessage: function (parseLinks, insertBRs, quote) {
            // parseLinks is an optional boolean for whether or not to convert URLs to HTML anchors
            // insertBRs is an optional boolean for replacing carriage returns with HTML line breaks
            // quote is an optional boolean for returning the message in quoted form (for reply box)

            //***: Not sure why decryptedMessage should be an array; there will only be one per Message?
            //
            parseLinks = _.isUndefined(parseLinks); //default is true
            insertBRs = _.isUndefined(insertBRs) ? parseLinks : insertBRs; //default same as parseLinks
            quote = _.isUndefined(quote) ? !parseLinks : quote; //default opposite of parseLinks

            if (this.decryptedMessage.length > 0) {
                console.log('Reading message from memory.');
                var msg = this.decryptedMessage[0];
                if (quote) msg = Parley.quote(msg);
                if (window.linkify && parseLinks) msg = linkify(msg);
                if (insertBRs) msg = Parley.insertBRs(msg);
                return [msg];
            } else {
                // This needs some error handling, must be bird-ass tight
                console.log('Decrypting message.');
                var sender = this.get('from');
                this.decryptedMessage = this.decryptedMessage || [];
                _.each(this.get('body'), _.bind(function (v,k) {
                    this.decryptedMessage.push(Parley.decryptAndVerify(v.content, this.get('from')));
                }, this));
                var msg = this.decryptedMessage[0];
                if (quote) msg = Parley.quote(msg);
                if (window.linkify && parseLinks) msg = linkify(msg);
                if (insertBRs) msg = Parley.insertBRs(msg);
                return [msg];
            }
        },
        toggleSelect: function () {
            this.set({'selected': !this.get('selected')});
            return this.get('selected');
        }
	});

	var MessageList = Backbone.Collection.extend({
	    model: Parley.Message
	});
	var MessageView = Backbone.View.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#messageTemplate').html()),
	    events: {
            'click':          'openMessage'
	    },
	    initialize: function (options) {
			this.listenTo(this.model, 'add', this.render);

			this.listenTo(this.model, 'change', this.render);
			this.listenTo(this.model, 'destroy', this.remove);
	    },
	    render: function () {
			this.$el.addClass('message').html(this.template(this.model.toJSON()));
			return this;
	    },

        openContact: function () {
            Parley.app.dialog('contacts', {single: this.model.get('from').toJSON()});
        },
	    openMessage: function () {
              if (Parley.readMessageView && Parley.readMessageView.model.get('message_id') == this.model.get('message_id')) {
                Parley.readMessageView.$el.remove();
                Parley.readMessageView = null;
              } else if (Parley.readMessageView) {
                Parley.readMessageView.$el.remove();
                Parley.readMessageView = new ReadMessageView({model:this.model});
                this.$el.after(Parley.readMessageView.render().el);
              } else {
                Parley.readMessageView = new ReadMessageView({model:this.model});

                this.$el.after(Parley.readMessageView.render().el);
              }
	    },
        toggleSelect: function () {
            this.model.toggleSelect();
        },
	});

    var ReadMessageView = Backbone.View.extend({
	    tagName: 'tr',
        attributes: {id:'readMessageView'},
	    template: Mustache.compile($('#readMessageTemplate').html()),
	    events: {
            'click .reply':     'openCompose'
	    },
	    render: function () {
            var message_body = _.reduce(this.model.readMessage(), function (memo, val) {
                return memo + '<p>' + val + '</p>';
            }, '');
            
			this.$el.addClass('message-body').html(this.template({body:message_body}));
			return this;
	    },

        openCompose: function () {
            Parley.app.dialog(
              'compose',
              _.extend(
                this.model.toJSON(),
                {'plainText':this.model.readMessage(false)}
              )
            );
        }
    });

	var User = Parley.Contact.extend({
	    defaults: function () {
			return { registered: false };
	    },
	    initialize: function () {
	    }
	});

    Parley._initialDialogs = [
        {   id: 'dialog_setup',
            template: Mustache.compile($('#setupDialogTemplate').html()),
            events: {
                'click #emailVerify': function (e) {
                    e.preventDefault();
                    var form = document.forms.emailVerify;
                    
                    if (_.isUndefined(form.email.value) || !Parley.rex.email.test(form.email.value)) {
                        Parley.formErrors('emailVerify', { email: _t('error-email-novalid') });
                        return false;
                    }

                    formdata = { email: form.email.value };
                    Parley.vent.trigger('setup:verify', formdata);
                },
                'click #loginAction': function (e) {
                    e.preventDefault();
                    var form = document.forms.loginAction;

                    if (_.isUndefined(form.password.value)) {
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
                    e.preventDefault();
                    var form = document.forms.changePassword;

                    if (!form.cur_password.value) {
                        Parley.formErrors('settings', { cur_password: _t('error-settings-invalidpassword') });
                        return false;
                    }

                    if (!form.new_password_1.value) {
                        Parley.formErrors('settings', { new_password_1: _t('error-settings-invalidpassword') });
                        return false;
                    }

                    if (form.new_password_2.value == form.new_password_1.value) {
                        Parley.changePass(form.cur_password.value, form.new_password_2.value, function (data, status) {
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
                    } else {
                        Parley.formErrors('changePassword', {
                            new_password_1: _t('error-settings-invalidpassword'),
                            new_password_2: _t('error-settings-invalidpassword')
                        });
                    }
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
                    this.to = this.reply_to ? this.reply_to.toJSON() : this.from ? this.from.toJSON() : undefined;
                    
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

                    var to = this.to;
                    var preFill = {};

                    if (_.isObject(to))
                        preFill = _.findWhere(items, {value: this.to.email}) || {};

                    var opts = {
                        selectedItemProp: 'name',
                        searchObjProps: 'name,value',
                        preFill: [preFill]
                    };
                    view.$('#recipient_to').each(function (){
                        $(this).autoSuggest(items, _.extend({asHtmlID: this.name}, opts));
                    });
                }
            }
        }
    ];

    var DialogView = Backbone.View.extend({
        tagName: 'div',

        initialize: function (options) {
            console.log('Initializing dialog' + options.model.slug);

            var _defaultEvents = {
                'keydown':                          'clickSubmit',
                'click .ui-dialog-titlebar-close':  'hide',
                'click #cancelButton':              'hide'
            };

            this.model = new Backbone.Model(options.model);
            this.template = options.template;
            this.events = _.extend(_defaultEvents, options.events);
            this.opts = _.extend({
                position: { my: 'center', at: 'center' },
                autoOpen: true,
                minWidth: 600,
                title: this.model.get('title')
            }, (this.model.get('opts') || {}));

            this.$el.appendTo('#dialogWrapper');

            this.listenTo(this.model, "change", this.render);
        },

        render: function () {
            console.log('Rendering dialog box.'); 

            this.dialog = this.$el
                .html( this.template(this.model.toJSON()) )
                .dialog( this.opts );

            this.$('form').trigger('reset');

            var page = this.model.get('page');
            if (!page) {
                this.$('.page').removeClass('page-active').first().addClass('page-active');
            } else {
                this.$('.page').removeClass('page-active').filter('.page-'+page).addClass('page-active');
            }
            this.delegateEvents(this.events);

            return this;
        },

        setData: function (data) {
            this.model.set(data);

            if (init = this.model.get('init')) this.model.set(init.call(this.model.toJSON()));
            return this;
        },
        isOpen: function () {
            return this.dialog && this.dialog.dialog('isOpen');
        },
        moveToTop: function () {
            return this.dialog && this.dialog.dialog('moveToTop');
        },
        show: function () {
            if (this.isOpen()) {
                this.render().moveToTop();
            } else {
                this.render().dialog.dialog('open');
            }

            if (loaded = this.model.get('loaded')) loaded.call(this.model.toJSON(), this);
            return this;
        },
        hide: function (e) {
            if (e && e.preventDefault) e.preventDefault();

            this.dialog.dialog( 'close' );
            return this;
        },

        clickSubmit: function (e) {
            var toClick;
            switch (e.keyCode) {
                case 13:
                    e.preventDefault();
                    toClick = this.$('.page-active .default-btn');
                    if (toClick.length == 0)
                        this.$('.default-btn').click();
                    else
                        toClick.click();
                case 27:
                    e.preventDefault();
                    break;
            }
        }
    });

	var AppView = Backbone.View.extend({
	    el: $('body'),

        blankTemplate: Mustache.compile($('#blankDialogTemplate').html()),
        tempDialogs: [],

	    events: {
            'click #composeAction': function (e) {
                console.log('Composing new message.');
                Parley.app.dialog('compose', {'from':null,'subject':null,'plainText':null});
            },
            'click #replyAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Replying to: ', sel);
                Parley.app.dialog('compose', reply_to.toJSON());
            },
			'click #settingsAction': function () {
                var userdata = Parley.currentUser.toJSON();
                this.dialog('settings', userdata);
            },
            'click #contactsAction': function () {
                this.dialog('contacts');
            },
            'click #refreshAction': function (e) { e.preventDefault(); Parley.vent.trigger('message:sync'); }
	    },

	    initialize: function () {
			console.log('Initializing Parley.');

            this._dialogs = [];
            for (var i=0,l=Parley._initialDialogs.length; i<l; i++) {
                var view = new DialogView(Parley._initialDialogs[i]);
                var slug = Parley._initialDialogs[i].model.slug;
                this._dialogs.push({slug:slug,view:view});
            }

			this.inbox = $('#inbox tbody');
			this.contactsList = $('<div>');

            $(window).on('resize', _.bind(this.resize, this));

			this.listenTo(Parley.inbox, 'add', this.addMessage);
			this.listenTo(Parley.contacts, 'add', this.addContact);

            (function (user,app) {
                if (!Parley.installed()){
                    app.dialog('show info installing', {
                        buttons:[{
                            id:'install_pgp', text:'ok',
                            handler: _.bind(function(){
                                Parley.install(_.bind(function(){
                                    console.log('No user logged in. Showing setup dialog.');
                                    this.dialog('hide info installing');
                                    this.dialog('setup');
                                }, this));
                            }, app)
                        }],
                        message: _t('message-installing')
                    });
                }else{
                    if (!user) {
                        console.log('No user logged in. Showing setup dialog.');
                        app.dialog('setup');
                    } else {
                        console.log('User logged in: ' + user);
                        Parley.currentUser = new Parley.Contact(JSON.parse(user));
                        app.dialog('setup login', _.extend({}, Parley.currentUser.toJSON()) );
                    }
                }
            })(false /* localStorage.getItem('currentUser') */,this);
	    },

	    render: function () {
            console.log('Rendering the app');
           
			this.$el.addClass('loggedin').removeClass('loggedout');
			this.$('.email').text(Parley.currentUser.get('email'));

            window.setTimeout(Parley.timer, Parley.timerDelay);

            return this;
		},

        resize: function () {
            console.log('Window resized');
            //this.dialog('show');
        },

        /**
        This function controls the dialog boxes.
        The syntax is like:

            Parley.app.dialog("(show|hide) [dialog slug] [page name]", data);
            
        If you omit the first word, it assumes 'show'
            Parley.app.dialog("[dialog slug]", data);

        If you pass it 'info' for the dialog slug, it will create a brand new
        separate dialog with [page name] as the slug. Use this for "loading" windows
        or modal dialogs.
        Make sure you pass a button:
            button: [{id:'buttonId',text:'click me',handler:function(){}}, etc.]
        as members of 'data'.
        **/
        dialog: function (opts,data) {
            var _buttons = {
                "okay": { id: "okayButton", text: _t('okay'), handler: function(e){ this.dialog('close'); } },
                "cancel": { id: "cancelButton", text: _t("cancel"), handler: function(e){ this.dialog('close'); } }
            };
            if (_.has(data, 'buttons')) {
                data.buttons = _.map(data.buttons, function (ele) {
                    if (_.isString(ele) && _.has(_buttons, ele)) return _buttons[ele];
                    else return ele;
                });
            }

            var _images = {
                "loading": "img/loader.gif",
                "logo": "img/logo.png",
                "logo_big": "img/logo_big.png"
            };

            var _blankOpts = { resizable: false, dialogClass: 'no-close', minWidth: '400' };

            if (data && _.has(_images, data.image)) data.image = _images[data.image];

            if (_.isString(opts)) {
                var _a = opts.split(' ');
                switch (_a[0]) {
                    case 'hide':
                        var slug = _a[1],
                            page = _a[2];
                        if (slug == 'info') {
                            var dialog = this.tempDialogs[page];
                            if (dialog) {
                                dialog.dialog('destroy');
                                this.tempDialogs[page] = undefined;
                            }
                        } else { 
                            var dialog = _(this._dialogs).findWhere({slug:slug});
                            if (dialog)
                                dialog.view.hide();
                        }

                        break;
                    case 'show':
                        if (opts == 'show') {
                            _.each(this._dialogs, function (ele) {
                                if (ele.view.isOpen()) {
                                    ele.view.show();
                                }
                            });
                            if (this.curDialog) this.curDialog.view.moveToTop();
                            break;
                        } else {
                            var slug = _a[1],
                                page = _a[2];
                        }
                    default:
                        var slug = slug || _a[0],
                            page = page || _a[1];
                        if (slug == 'info') {
                            if (_.has(this.tempDialogs, page)) {
                                var dialog = this.tempDialogs[page];
                                dialog.html(this.blankTemplate(data));
                            } else {
                                var dialog = $(this.blankTemplate(data)).dialog(_blankOpts);
                                this.tempDialogs[page] = dialog;

                                _.each(data.buttons, function (ele) {
                                    $(document).on('click', '#'+ele.id, _.bind(ele.handler, dialog));
                                });
                            }
                        } else {
                            var dialog = this.curDialog = _(this._dialogs).findWhere({slug:slug});
                            if (dialog) {
                                dialog.view.setData(_.extend({page:page},data)).show();
                            } else {
                                var view = new DialogView({
                                    model: data,
                                    template: this.blankTemplate,
                                    id: 'dialog_' + slug
                                });
                                dialog = this.curDialog = {
                                    slug: slug,
                                    view: view
                                }
                                this._dialogs.push(dialog);

                                view.setData(_.extend(data,{page:page})).show();
                            }
                        }

                        break;
                }
            }
        },

		addContact: function (contact) {
			var view = new ContactView({model: contact});
			this.contactsList.append(view.render().el);
		},

	    addMessage: function (message) {
			var view = new MessageView({model: message});
			this.inbox.append(view.render().el);
	    },

        kill: function () {
            // Clear local storage
			this.$el.addClass('loggedout').removeClass('loggedin');
			this.$('.email').text(Parley.currentUser.get('email'));

            this.inbox.empty();
            Parley.inbox.reset();

            this.contactsList.empty();
            Parley.contacts.reset();

            Parley.app.dialog('setup');
        }
	});

    // Just grab the '_phrases' object from the dictionary file
    Parley.polyglot = new Polyglot({phrases: window._phrases, locale: 'en'});
    window._t = function (key,data) { return Parley.polyglot.t(key,data); };
    window._T = function (key,data) { var word = Parley.polyglot.t(key,data); return word.charAt(0).toUpperCase() + word.slice(1); };

    Parley.inbox = new MessageList;
    Parley.contacts = new ContactList;
	Parley.app = new AppView;
}(window.Parley = window.Parley || {}, jQuery));
