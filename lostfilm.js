(function(plugin) {
    var PREFIX = plugin.getDescriptor().id;
    var TITLE = plugin.getDescriptor().title;
    var SYNOPSIS = plugin.getDescriptor().synopsis;
    var LOGO = plugin.path + "logo.png";
    var BASE_URL = "http://www.lostfilm.tv/";

    var service = require("showtime/service");
    var http = require("./http");
    var html = require("showtime/html");

    service.create(TITLE, PREFIX + ":start", "video", true, LOGO);

    var store = plugin.createStore("config", true);

    plugin.search = true;
    plugin.addSearcher(TITLE, LOGO, search)
    plugin.addURI(PREFIX + ":start", start);
    plugin.addURI(PREFIX + ":allSerials:(.*):(.*):(.*)", populateAll);
    plugin.addURI(PREFIX + ":serialInfo:(.*):(.*):(.*)", serialInfo);
    plugin.addURI(PREFIX + ":torrent:(.*):(.*)", function (page, serieName, dataCode) {
        page.loading = true;
        var attributes = dataCode.split('-');
        var c = attributes[0];
        var s = attributes[1];
        var e = attributes[2];
        var response = http.request(BASE_URL + "v_search.php?c=" + c + "&s=" + s + "&e=" + e);
        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        var response = http.request(torrentsUrl)

        var foundTorrents = {
            "sd": undefined,
            "hd": undefined,
            "fhd": undefined
        };

        var torrentArr = html.parse(response.toString()).root.getElementByClassName("inner-box--item");
        for (var i = 0; i < torrentArr.length; ++i) {
            var currentTorrent = torrentArr[i];
            var currentTorrentLabel = currentTorrent.getElementByClassName("inner-box--label")[0].textContent.trim().toLowerCase();
            var currentTorrentLink = currentTorrent.getElementByClassName("inner-box--link main")[0].children[0].attributes.getNamedItem("href").value;
            showtime.print("found torrent " + currentTorrentLabel + ". url = " + currentTorrentLink);

            if (currentTorrentLabel == "sd") {
                foundTorrents["sd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "mp4" || currentTorrentLabel == "hd" || currentTorrentLabel == "720") {
                foundTorrents["hd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "fullhd" || currentTorrentLabel == "full hd" || currentTorrentLabel == "1080") {
                foundTorrents["fhd"] = currentTorrentLink;
            }
        }

        var desiredUrl = foundTorrents[store.quality];

        if (desiredUrl == undefined) {
            if (foundTorrents["sd"]) {
                desiredUrl = foundTorrents["sd"];
                showtime.print(store.quality + " torrent not found. Playing SD instead...");
            } else if (foundTorrents["hd"]) {
                desiredUrl = foundTorrents["hd"];
                showtime.print(store.quality + " torrent not found. Playing HD instead....");
            } else if (foundTorrents["fhd"]) {
                desiredUrl = foundTorrents["fhd"];
                showtime.print(store.quality + " torrent not found. Playing Full HD instead....");
            }
        } else {
            showtime.print(store.quality + " torrent found. Playing it...");
        }

        if (desiredUrl == undefined || desiredUrl == "") {
            page.error("Failed to find desired torrent.");
            return;
        }

        // set watched if it wasn't before
        var watchedSeries = getWatched(attributes[0]);
        if (watchedSeries.indexOf(dataCode) < 0) {
            toggleWatched(dataCode);
        }

        page.loading = false;
        page.source = "videoparams:" + showtime.JSONEncode({
            title: serieName,
            canonicalUrl: PREFIX + ":torrent:" + serieName + ":" + dataCode,
            sources: [{
                url: 'torrent:video:' + desiredUrl
            }]
        });
        page.type = "video";
    });

    function start(page) {
        page.loading = true;
        page.metadata.logo = LOGO;
        page.metadata.title = TITLE;
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/main.view";

        // need to move to separate function
        page.options.createMultiOpt('quality', 'Quality', [
            ['sd',  'SD', true],
            ['hd',       'HD'],
            ['fhd',      'Full HD']], 
            function(v) {
                store.quality = v;
            },
        true);

        if (store.quality == undefined || store.quality == "") {
            store.quality = "sd";
        }

        if (checkCookies()) {
            applyCookies();
            populateMainPage(page);
        } else if (performLogin(page)) {
            applyCookies();
            populateMainPage(page);
        } else {
            page.error("Login failed. Please check your credentials.");
        }
        
        page.loading = false;
    }

    function checkCookies() {
        return store.userCookie && store.userCookie != "DONT_TOUCH_THIS";
    }

    function applyCookies() {
        plugin.addHTTPAuth("http://.*\\.lostfilm\\.tv", function(req) {
            req.setHeader("Cookie", store.userCookie);
            req.setHeader('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0');
        });
    }

    function populateMainPage(page) {
        populateSerials(page, "Favorites", 2, 99);
        populateSerials(page, "Popular", 1, 0);
        populateSerials(page, "New", 1, 1);
        populateSerials(page, "Filming", 1, 2);
        populateSerials(page, "Finished", 1, 5);
    }

    function populateSerials(page, name, s, t) {
        var serialsList = getSerialList(0, s, t);
        if (serialsList && serialsList.length > 0) {
            page.appendItem("", "separator", {
                title: name
            });

            for (var i = 0; i < serialsList.length; ++i) {
                var serialDescription = getSerialDescription(serialsList[i].id, serialsList[i].link);
                page.appendItem(PREFIX + ":serialInfo:" + serialsList[i].title + ":" + serialsList[i].id + ":" + serialsList[i].link, "directory", {
                    title: serialsList[i].title,
                    icon: "http://static.lostfilm.tv/Images/" + serialsList[i].id + "/Posters/poster.jpg",
                    description: serialDescription,
                    rating: serialsList[i].rating * 10.0
                });
            }

            if (s !== 2) {
                page.appendItem(PREFIX + ":allSerials:" + name + ":" + s + ":" + t, "directory", {
                    title: "Show all..."
                });
            }
        }
    }

    function populateAll(page, name, s, t) {
        page.metadata.title = name + " (by rating)";
        page.model.contents = "list";
        page.type = "directory";

        var offset = 0;

        (page.asyncPaginator = function() {
            page.loading = true;
            page.type = "directory";
            page.metadata.glwview = plugin.path + "views/main.view";
            var serials = getSerialList(offset, s, t);

            if (serials.length == 0) {
                page.loading = false;
                page.haveMore(false);
                return;
            } else {
                offset += serials.length;
            }

            for (var i = 0; i < serials.length; ++i) {
                var serialDescription = getSerialDescription(serials[i].id, serials[i].link);
                page.appendItem(PREFIX + ":serialInfo:" + serials[i].title + ":" + serials[i].id + ":" + serials[i].link, "directory", {
                    title: serials[i].title,
                    icon: "http://static.lostfilm.tv/Images/" + serials[i].id + "/Posters/poster.jpg",
                    description: serialDescription,
                    rating: serials[i].rating * 10.0
                });
            }

            page.loading = false;
            page.haveMore(true);
        })();
    }

    function getSerialDescription(serialID, serialUrl) {
        var checkCache = plugin.cacheGet("SerialsDescriptions", serialID.toString());
        if (checkCache && checkCache.length > 0) {
            return checkCache;
        }

        var response = http.request(BASE_URL + serialUrl);
        var description = html.parse(response.toString()).root.getElementByClassName("text-block description")[0].getElementByClassName("body")[0].getElementByClassName("body")[0].textContent;
        plugin.cachePut("SerialsDescriptions", serialID.toString(), description, 604800);
        return description;
    }

    function getSerialList(o, s, t) {
        // s: 1=>by rating; 2=>by alphabet; 3=>by date
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: true,
            postdata: {
                'act': 'serial',
                'type': 'search',
                'o': o || '0',
                's': s || '1',
                't': t || '0'
            }
        });
        return showtime.JSONDecode(response.toString()).data;
    }

    // not used
    function setFavorite(serialID, enabled) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: true,
            postdata: {
                'act': 'serial',
                'type': 'follow',
                'id': serialID
            }
        });
    }

    function toggleWatched(dataCode) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: true,
            postdata: {
                'act': 'serial',
                'type': 'markepisode',
                'val': dataCode
            }
        });
    }

    function getWatched(serialID) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: true,
            postdata: {
                'act': 'serial',
                'type': 'getmarks',
                'id': serialID
            }
        });
        var responseObj = showtime.JSONDecode(response.toString());
        return responseObj.data || [];
    }

    function serialInfo(page, serialName, serialID, url) {
        page.metadata.logo = LOGO;
        page.metadata.title = serialName;
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/serial.view";
        page.loading = true;

        var response = http.request(BASE_URL + url + "/seasons/");
        var seasonsList = html.parse(response.toString()).root.getElementByClassName("serie-block");
        for (var i = 0; i < seasonsList.length; ++i) {
            var seasonEmpty = true;
            var seasonSeries = seasonsList[i].getElementByTagName("tr");
            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                } else {
                    seasonEmpty = false;
                    break;
                }
            }

            if (seasonEmpty) {
                continue;
            }

            var seasonName = seasonsList[i].getElementByTagName("h2")[0].textContent;
            page.appendItem("", "separator", {
                title: seasonName
            })

            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                }
                var dataCode = seasonSeries[j].getElementByClassName(["alpha"])[0].children[0].attributes.getNamedItem("data-code").value;
                var serieDiv = seasonSeries[j].getElementByClassName(["gamma"])[0].children[0];
                var serieDirtyName = serieDiv.textContent.trim();
                var serieNativeName = serieDiv.getElementByTagName("span")[0].textContent;
                var serieNumber = seasonSeries.length - j;
                var serieName = serieDirtyName.replace(serieNativeName, "") + " (" + serieNativeName + ")";

                page.appendItem(PREFIX + ":torrent:" + serieName + ":" + dataCode, "video", {
                    title: new showtime.RichText("<font color='#b3b3b3'>[" + (serieNumber < 10 ? "0" : "") + serieNumber + "]</font>    " + serieName)
                });
            }
        }

        page.loading = false;
    }

    function performLogin(page) {
        var credentials = plugin.getAuthCredentials(SYNOPSIS, "Login required", true);
        var response, result;
        if (credentials.rejected) return false; //rejected by user
        if (credentials) {
            response = http.request("http://login1.bogi.ru/login.php?referer=" + BASE_URL, {
                postdata: {
                    'login': credentials.username,
                    'password': credentials.password,
                    'module': 1,
                    'target': BASE_URL,
                    'repage': 'user',
                    'act': 'login'
                },
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': BASE_URL,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            var bogiDom = html.parse(response.toString());
            var formAction = bogiDom.root.getElementById("b_form").attributes.getNamedItem("action");

            var inputs = bogiDom.root.getElementById("b_form").getElementByTagName("input");
            var outputs = {};
            for (var i = 0; i < inputs.length; ++i) {
                var inputName = inputs[i].attributes.getNamedItem("name");
                var inputValue = inputs[i].attributes.getNamedItem("value");
                if (inputName && inputValue) {
                    var resultName = inputName["value"];
                    var resultValue = inputValue["value"];
                    outputs[resultName] = resultValue;
                }
            }

            response = http.request(formAction["value"], {
                postdata: outputs,
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': BASE_URL,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            return saveUserCookie(response.multiheaders);
        } else {
            return false;
        }
    }

    function saveUserCookie(headers) {
        var cookie;
        if (!headers) return false;
        cookie = headers["Set-Cookie"];
        if (cookie) {
            cookie.join("");
            store.userCookie = cookie;
            return true;
        } else {
            return false;
        }
    }

    function search(page, query) {
        var response = http.request(BASE_URL + "ajaxik.php", {
            debug: true,
            postdata: {
                'act': 'common',
                'type': 'search',
                'val': query
            }
        });

        var series = showtime.JSONDecode(response.toString()).data["series"];
        for (var i = 0; i < series.length; ++i) {
            page.appendItem(PREFIX + ":serialInfo:" + series[i].title + ":" + series[i].id + ":" + series[i].link, "video", {
                title: series[i].title,
                description: series[i].title,
                icon: "http://static.lostfilm.tv/Images/" + series[i].id + "/Posters/poster.jpg"
            });
        }

        page.entries = series.length;
    }
})(this);
