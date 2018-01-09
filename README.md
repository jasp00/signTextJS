signTextJS plus
===============

`window.crypto.signText` support and enhancements

Why signTextJS plus?
--------------------
The goal of the original signTextJS is to provide a stop-gap measure for users
while sites migrate away from `window.crypto.signText`. signTextJS plus is meant
to last longer and enhances the add-on with features such as automatic
signatures and filtering by certificate authority.

How-to
------
This is still work in progress. The Firefox extension depends on a native back
end which needs deployment. You can download the installer at the
[releases](https://github.com/jasp00/signTextJS/releases) page. The add-on works
on Linux and it is expected to work on Windows 64 and macOS too.

For system-wide availability:
* On Linux, run the installer as root.
* On Windows, the installer will ask you.
* On macOS, do the usual DMG installation.

For per-user availability:
* On Linux, run the installer as the user.
* On Windows, the installer will ask you.
* On macOS, open the DMG and deploy
[manually](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Native_manifests).

To develop the Firefox extension, try a
[temporary installation](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox).
Alternatively, install the WebExtensions SDK following the directions
[here](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext).
Then, after checking out this repository, change to directory `webextension` and
execute `web-ext run` to run Firefox with the extension or `web-ext build` to
package the extension. After the extension and the native back end have been
installed, page scripts that call `window.crypto.signText` should "just work".

If there is no installer for your architecture, you can compile the application
and
[set up](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Native_manifests#Manifest_location)
the environment. The files in directory `travis` have the steps to install
dependencies, compile the native back end, run a test, and build the installer.

Firefox versions prior to 57 should stick with version 0.8.7. You may install
the latest published version
[here](https://addons.mozilla.org/en-US/firefox/addon/signtextjs-plus/).

Corresponding source
--------------------
You may find the corresponding source at the add-on
[home page](https://github.com/jasp00/signTextJS).

TODO
----
See [issues](https://github.com/jasp00/signTextJS/issues).
