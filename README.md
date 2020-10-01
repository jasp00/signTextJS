signTextJS plus
===============

`window.crypto.signText` support and enhancements

Why signTextJS plus?
--------------------
`window.crypto.signText` is a digital signature technology that has been
available since 1998. It is used by government and banking sites. It can be used
to participate in plebiscites.

The `window.crypto` interfaces were removed from Firefox 35 and later releases.
An add-on was developed as a stop-gap measure for users; that add-on is
deprecated and does not work since Firefox 57.

signTextJS plus takes over this technology. It restores automatic signatures and
filtering by certificate authority, and provides these enhancements:
* An asynchronous mode.
* Filtering by non-repudiation.
* SHA-256 support.

How-to
------
This is still work in progress. The Firefox extension depends on a native back
end which needs deployment. You can download the installer at the
[releases](https://github.com/jasp00/signTextJS/releases) page. The add-on works
on Linux and Windows 64, and it is expected to work on macOS too.

For system-wide availability:
* On Linux, run the installer as root.
* On Windows, the installer will ask you.
* On macOS, do the usual DMG installation.

For per-user availability:
* On Linux, run the installer as the user.
* On Windows, the installer will ask you.
* On macOS, open the DMG and deploy [manually](
https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Native_manifests).

To develop the Firefox extension, try a [temporary installation](
https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox
). Alternatively, install the WebExtensions SDK following the [directions](
https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext
) from Mozilla. Then, after checking out this repository, change to directory
`webextension` and execute `web-ext run` to run Firefox with the extension or
`web-ext build` to package the extension. After the extension and the native
back end have been installed, scripts that call `window.crypto.signText` should
"just work".

If there is no installer for your architecture, you can compile the application
and [set up](
https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Native_manifests#Manifest_location
) the environment. The files in directory `travis` have the steps to install
dependencies, compile the native back end, run a test, and build the installer.

You may install the [latest published
extension](https://addons.mozilla.org/en-US/firefox/addon/signtextjs-plus/) from
Mozilla. Firefox versions prior to 57 should stick with version [0.8.7](
https://github.com/jasp00/signTextJS/files/5250259/signtextjs_plus-0.8.7-fx.xpi.zip
); its source code is available at branch
[`add-on-sdk`](https://github.com/jasp00/signTextJS/tree/add-on-sdk).

Documentation
-------------
Project
[documentation](https://github.com/jasp00/signTextJS/raw/master/doc/index.xhtml)
is available under directory `doc`. You might be interested in
[Showoctocats](https://addons.mozilla.org/en-US/firefox/addon/showoctocats/) if
you want to render these pages as XHTML directly.

Test page
---------
You may test the add-on at the HTML [test
page](https://github.com/jasp00/signTextJS/raw/master/test/html/test.html).
Again, you might be interested in Showoctocats if you want to render this page
as HTML directly.

Corresponding source
--------------------
You may find the corresponding source at the add-on
[home page](https://github.com/jasp00/signTextJS).

TODO
----
See [issues](https://github.com/jasp00/signTextJS/issues).
