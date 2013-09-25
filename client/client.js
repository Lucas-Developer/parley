(function(Parley, $, undefined){
    Parley.vent = Parley.vent || _.extend({}, Backbone.Events);

	Parley.Contact = Backbone.Model.extend({
	    defaults: function () {
			return {
				last_received: 0,
				last_sent: 0,
				thumbnail: false,
				count: 0,
                email: '',
                fingerprint: '',
                messages: [],
                pending: false,
                isCurrentUser: false
			}
	    },
        idAttribute: 'email',
        initialize: function (attrs) {
            console.log('Initializing contact.');

            if (!attrs)
                return true;

            if (attrs.isCurrentUser) {
                // Any current user specific initialization stuff here.
            } else if (attrs.pending) {
                // Any pending user intialization stuff here.
            } else {
                // Any normal contact (not current user, not pending user) initialization stuff here.
                Parley.getUserInfo(this, function (contact) {
                    if (contact && !contact.error) {
                        var data = contact.toJSON && contact.toJSON();
                        console.log('Contact initialized: ' + data.email);
                        Parley.contacts.add(contact, { merge: true });
                        Parley.storeKeyring();
                    } else {
                        // Didn't return a proper contact object
                        console.log(contact.error);
                    }
                });
            }
        },

        invited: function () {
            return this.attributes.invited;
        }
	});

	Parley.ContactList = Backbone.Collection.extend({
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

            if (from.email in data.person_info) from_obj.set('thumbnail', data.person_info[from.email].thumbnail);

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
                _(this.get('body')).each(_.bind(function (v,k) {
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
            Parley.dialog('contacts', {single: this.model.get('from').toJSON()});
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
            'click .reply':     'openCompose',
            'click .replyAll':     'openCompose'
	    },
	    render: function () {
            var model = this.model;

			this.$el
                .addClass('message-body')
                .html(this.template({
                    body: model.readMessage(),
                    date: moment(model.get('date') * 1000).format('MMMM Do YYYY, h:mm:ss a'),
                    to: _(model.get('addresses').to).map(function (addr) {
                        return (addr.email == Parley.currentUser.get('email')) ? { user: true } : { name: addr.name, email: addr.email };
                    })
                }));
			return this;
	    },

        openCompose: function (e) {
            e.preventDefault();
            Parley.dialog('compose',
                _.extend( this.model.toJSON(),
                    {
                        'plainText': this.model.readMessage(false),
                        'replyAll': $(e.target).hasClass('replyAll')
                    }
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

        tempDialogs: [],

	    events: {
            'click a': function (e) {
                var hrefParts = e.target.href.split(':');
                switch (hrefParts[0]) {
                    case 'mailto':
                        var email = hrefParts[1],
                            contact;

                        if (contact = Parley.contacts.findWhere({email: email}))
                            Parley.dialog('show compose', { reply_to: contact });
                        else
                            Parley.dialog('show info nocontact', {
                                message: _t('message-contacts-noexist'),
                                buttons: [
                                    {
                                        id: 'addContactAction',
                                        text: _t('add new contact'),
                                        handler: function (e) {
                                            e.preventDefault();
                                            Parley.dialog('show contacts newcontact', { newemail: email} );
                                            Parley.dialog('hide info nocontact');
                                        },
                                    },
                                    'cancel'
                                ]
                            });

                        return false;
                    default:
                        break;
                }
            },
            'click #composeAction': function (e) {
                console.log('Composing new message.');
                Parley.dialog('compose', {'from':null,'subject':null,'plainText':null});
            },
            'click #replyAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Replying to: ', sel);
                Parley.dialog('compose', reply_to.toJSON());
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

			this.inbox = $('#inbox tbody');
			this.contactsList = $('<div>');

            $(window).on('resize', _.bind(this.resize, this));

			this.listenTo(Parley.inbox, 'add', this.addMessage);
			this.listenTo(Parley.contacts, 'add', this.addContact);

            (function (user) {
                if (!Parley.installed()){
                    Parley.dialog('show info installing', {
                        buttons:[{
                            id:'install_pgp', text:'ok',
                            handler: function () {
                                Parley.install(function(){
                                    console.log('No user logged in. Showing setup dialog.');
                                    Parley.dialog('hide info installing');
                                    Parley.dialog('setup');
                                });
                            }
                        }], message: _t('message-installing')
                    });
                }else{
                    if (!user) {
                        console.log('No user logged in. Showing setup dialog.');
                        Parley.dialog('setup');
                    } else {
                        console.log('User logged in: ' + user);
                        Parley.currentUser = new Parley.Contact(JSON.parse(user));
                        Parley.dialog('setup login', _.extend({}, Parley.currentUser.toJSON()) );
                    }
                }
            })(false /* localStorage.getItem('currentUser') */);
	    },

        dialog: function (opts, data) { Parley.dialog(opts, data); },

	    render: function () {
            console.log('Rendering the app');
           
			this.$el.addClass('loggedin').removeClass('loggedout');
			this.$('.email').text(Parley.currentUser.get('email'));

            Parley.timer.start();

            return this;
		},

        resize: function () {
            console.log('Window resized');
            //this.dialog('show');
        },

		addContact: function (contact) {
			var view = new ContactView({model: contact});
			this.contactsList.append(view.render().el);
		},

	    addMessage: function (message) {
			var view = new MessageView({model: message});
			this.inbox.append(view.render().el);
	    },

        quit: function () {
			this.$el.addClass('loggedout').removeClass('loggedin');
			this.$('.email').text('');

            // Stop the timer.
            Parley.timer.stop();

            // Remove the DOM elements from the inbox and empty the collection.
            this.inbox.empty();
            Parley.inbox.reset();

            // Remove the DOM elements from the contact list and empty the collection.
            this.contactsList.empty();
            Parley.contacts.reset();

            if (Parley.currentUser) {
                // Clear the current user.
                if (!Parley.currentUser.get('remember')) {
                    // **TODO: purge records from local storage
                }

                Parley.currentUser.clear({silent:true});
            }

            console.log( "inbox: " + JSON.stringify(Parley.inbox.toJSON()) );
            console.log( "contacts: " + JSON.stringify(Parley.contacts.toJSON()) );
            console.log( "user: " + JSON.stringify(Parley.currentUser.toJSON()) );
            console.log( "Thank you." );

            _.delay(Parley.dialog, 2000, 'setup verify');
        }
	});

    // Just grab the '_phrases' object from the dictionary file
    Parley.polyglot = new Polyglot({phrases: window._phrases, locale: 'en'});
    window._t = function (key,data) { return Parley.polyglot.t(key,data); };
    window._T = function (key,data) { var word = Parley.polyglot.t(key,data); return word.charAt(0).toUpperCase() + word.slice(1); };

    Parley.dialog = (function(){
        var _buttons = {
            "okay": { id: "okayButton", text: _t('okay'), handler: function(e){ e.preventDefault(); this.dialog('close'); } },
            "cancel": { id: "cancelButton", text: _t("cancel"), handler: function(e){ e.preventDefault(); this.dialog('close'); } }
        }, _images = {
            "loading": "img/loader.gif",
            "logo": "img/logo.png",
            "logo_big": "img/logo_big.png"
        }, _blankOpts = {
            resizable: false,
            dialogClass: 'no-close',
            minWidth: '400'
        }, tempDialogs = {}, curDialog, blankTemplate, _dialogs;

        blankTemplate = Mustache.compile($('#blankDialogTemplate').html());

        _dialogs = _(Parley._initialDialogs).map(function (ele) {
            return { slug: ele.model.slug, view: new DialogView(ele) };
        });

        return function (opts, data) {
            if (data && data.buttons) {
                data.buttons = _(data.buttons).map(function (ele) {
                    if (_.isString(ele) && ele in _buttons) return _buttons[ele];
                    else return ele;
                });
            }

            if (data && data.image in _images) data.image = _images[data.image];

            if (_.isString(opts)) {
                var _a = opts.split(' ');
                switch (_a[0]) {
                    case 'hide':
                        var slug = _a[1],
                            page = _a[2];
                        if (slug == 'all') {
                            _(_dialogs).each(function (ele) { ele.hide(); });
                        } else if (slug == 'info') {
                            var dialog = tempDialogs[page];
                            if (dialog) {
                                dialog.dialog('destroy');
                                delete tempDialogs[page];
                            }
                        } else { 
                            var dialog = _(_dialogs).findWhere({slug:slug});
                            if (dialog)
                                dialog.view.hide();
                        }

                        break;
                    case 'show':
                        if (opts == 'show') {
                            _(_dialogs).each(function (ele) {
                                if (ele.view.isOpen()) {
                                    ele.view.show();
                                }
                            });
                            if (curDialog) curDialog.view.moveToTop();
                            break;
                        } else {
                            var slug = _a[1],
                                page = _a[2];
                        }
                    default:
                        var slug = slug || _a[0],
                            page = page || _a[1];
                        if (slug == 'info') {
                            if (page in tempDialogs) {
                                var dialog = tempDialogs[page];
                                dialog.html(blankTemplate(data));
                            } else {
                                var dialog = $(blankTemplate(data)).dialog(_blankOpts);
                                tempDialogs[page] = dialog;

                                _(data.buttons).each(function (ele) {
                                    $(document).on('click', '#'+ele.id, _.bind(ele.handler, dialog));
                                });
                            }
                        } else {
                            var dialog = curDialog = _(_dialogs).findWhere({slug:slug});
                            if (dialog) {
                                dialog.view.setData(_.extend({page:page},data)).show();
                            } else {
                                var view = new DialogView({
                                    model: data,
                                    template: blankTemplate,
                                    id: 'dialog_' + slug
                                });
                                dialog = curDialog = {
                                    slug: slug,
                                    view: view
                                }
                                _dialogs.push(dialog);

                                view.setData(_.extend(data,{page:page})).show();
                            }
                        }

                        break;
                }
            }
        };
    })();

    Parley.inbox = new MessageList;
    Parley.contacts = new Parley.ContactList;
	Parley.app = new AppView;
}(window.Parley = window.Parley || {}, jQuery));
