import * as path from 'path';
import Bundler=require('parcel-bundler');
import express=require('express');
import { config } from './Config';
import { prototype } from 'events';

var ssdp=require('node-ssdp').Client
    , client=new ssdp({});
const mSearch='urn:schemas-upnp-org:device:PoolController:1';
let { override, autoDiscovery, poolURL }: { override: { protocol: string, host: string, port: number }, autoDiscovery: boolean, poolURL?: string }=config.getSection("discovery");
let { protocol, host, port }: { protocol: string, host: string, port: number }=override;
let timeout: NodeJS.Timeout;

function search(force?: boolean) {
    if(autoDiscovery||force) {
        if(typeof timeout!==undefined) clearTimeout(timeout);
        client.search(mSearch);
        timeout=setTimeout(function() {
            console.log('restarting search');
            client.stop();
            search();
        }, 5000);
    }
}

const reloadVars=() => {
    let d=config.getSection('discovery');
    override=d.override;
    autoDiscovery=d.autoDiscovery;
    poolURL=d.poolURL;
    protocol=d.override.protocol;
    host=d.override.host;
    port=d.override.port;
    if(!autoDiscovery) {
        if(typeof poolURL==='undefined'||poolURL!==`${ protocol }://${ host }:${ port }`) {
            let { protocol, host, port }=override;
            poolURL=`${ protocol }://${ host }:${ port }`;
            saveVars();
        }
    }
}
const saveVars=() => {
    let d=config.getSection('discovery');
    d.override=override;
    d.autoDiscovery=autoDiscovery;
    d.poolURL=poolURL;
    d.override.protocol=protocol;
    d.override.host=host;
    d.override.port=port;
    config.setSection('discovery', d);
}

async function startBundler() {
    const app=express();
    client.on('response', function inResponse(headers, code, rinfo) {
        if(headers.ST!==mSearch||!autoDiscovery) { return; }
        clearTimeout(timeout);
        console.log('Got a response to an m-search:\n%d\n%s\n%s', code, JSON.stringify(headers, null, '  '), JSON.stringify(rinfo, null, '  '));
        // console.log(headers.LOCATION);
        const oldUrl=poolURL;
        poolURL=headers.LOCATION.match(/^.+?[^\/:](?=[?\/]|$)/)[0];
        console.log(`IN SEARCH --- ${ poolURL }`)
        if(typeof poolURL!=='undefined'&&poolURL!==oldUrl) console.log(`Found pool server at new address ${ poolURL } (previously was ${ oldUrl })`)

        saveVars();
        client.stop();
    });

    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, DELETE');
        console.log(`${ req.method } ${ req.path }`)
        next();
    });
    app.use(express.json());
    app.get('/discover', (req, res) => {
        reloadVars();
        if(!autoDiscovery) {

            // res.status(200).send({ url: `${protocol}://${host}:${port}` });

        }
        else if(autoDiscovery&&typeof poolURL==='undefined') {
            console.log(`SSDP: cannot find poolController with discovery.  Please set address manually in config.json in the format of 'http://ip:port/`);
            client.search(mSearch);
        }
        res.status(200).json({ override, autoDiscovery, poolURL });
    });

    app.get('/recheck', (req, res) => {
        reloadVars();
        if(!autoDiscovery) {
            console.log(`Config.json set to override SSDP: ${ poolURL }.`)
        }
        else {
            console.log(`Webapp not able to connect; forcing mSearch.`)
            client.search(mSearch, true);
        }
        return res.status(200);
    })

    app.get('/visibility', (req, res) => {
        res.send(config.getSection('options').hidePanels)
    })
    app.delete('/panel', (req, res) => {
        let options=config.getSection("options")
        options.hidePanels=[];
        res.send(config.setSection('options', options))
    })
    app.put('/panel', (req, res) => {
        let options=config.getSection("options")
        let { hidePanels }=options;
        const { name, state }=req.body;
        if(state==='hide') {

            if(!hidePanels.includes(name)) {
                hidePanels.push(name);
            }
        }
        else {
            const index=hidePanels.indexOf(name);
            if(index!==-1) {
                hidePanels.splice(index, 1);
            }
        }
        console.log(JSON.stringify(options, null, 2))
        config.setSection("options", options);
        reloadVars();
        res.send(config.setSection('options', options))
    })

    app.get('/startOverride', (req, res) => {
        autoDiscovery=false;
        poolURL=`${ protocol }://${ host }:${ port }`
        saveVars();
        client.stop();
        if(typeof timeout!==undefined) clearTimeout(timeout);
        res.status(200).json({ override, autoDiscovery, poolURL });
    })
    app.put('/override', (req, res) => {
        protocol=req.body.protocol;
        host=req.body.host;
        port=parseInt(req.body.port, 10);
        poolURL=`${ protocol }://${ host }:${ port }`
        autoDiscovery=false;
        saveVars();
        res.status(200).json({ override, autoDiscovery, poolURL });
        client.stop();
        if(typeof timeout!==undefined) clearTimeout(timeout);
    })

    app.delete('/override', (req, res) => {
        autoDiscovery=true;
        poolURL=undefined;
        saveVars();
        res.status(200).json({ override, autoDiscovery, poolURL });
        search();
    })

    // Parcel: absolute path to entry point
    const file=path.join(process.cwd(), './web/dashboard/index.html');
    console.log(`Parcel serving files from: ${ file }`);
    // Parcel: set options
    const options={
        outDir: './dist/web'
    };
    // Parcel: Initialize a new bundler
    const bundler=new Bundler(file, options);
    // Let express use the bundler middleware, this will let Parcel handle every request over your express server
    app.use(bundler.middleware());

    // Listen on port 8080
    app.listen(config.getSection("web").port);
    search();
}

startBundler();
