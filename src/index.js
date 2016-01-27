import 'babel-polyfill'
import React from 'react'
import { render as reactRender } from 'react-dom'
import fetch from 'isomorphic-fetch'
import EventEmitter from 'events'
import Zip from 'jszip'
import {saveAs} from './lib/FileSaver'
import {safeDump as toYaml} from 'js-yaml'

import './index.less'

const after = (fn, advice) => (...args) => advice(fn(...args))

const state = {
  lists: null,
  error: null,
  status: null
}
const events = new EventEmitter()
events.on('userlists-success', after((lists) => ({
  ...state, lists
}), render))
events.on('userlists-error', after((error) => ({
  ...state, error
}), render))
events.on('status', after((status) => ({
  ...state, status
}), render))

function render (state) {
  reactRender(
    <App
      {...state}
      onSubmit={(data) => fetchGatherCollections(data, events)}
      onDownload={downloadZip}
      />
  , document.getElementById('root'))
}

const App = ({ lists, error, status, onSubmit, onDownload }) => (
  <div className='App container'>
    <h1>Gather exporter</h1>
    <div className='row'>
      <p>Export your gather collections from a Wikimedia wiki.</p>
      <p style={{color: '#888', fontStyle: 'italic'}}>
        Supports up to 500 collections and up to the first 500 items of the
        collection.
      </p>
      {error ? <p style={{color: 'red'}}>{error.message}</p> : null}
    </div>
    <DownloadForm status={status} onSubmit={onSubmit}/>
    <div className='row'>
      {lists
        ? <div className='Lists'>
            <button className='Download button-primary' onClick={() => onDownload(lists)}>
              Download zip file
            </button>
            <table className='u-full-width'>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) =>
                  <tr key={list.id}>
                    <td>{list.label}</td>
                    <td>{list.description}</td>
                    <td>{list.count}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        : null}
    </div>
    <div className='row'>
      <p>
        Contact: <a
        href='https://github.com/joakin/gather-exporter/issues'>Issues</a> and <a
          href='https://github.com/joakin/gather-exporter'>source</a>
      </p>
      <p>Made with {'<3'} by <a href='https://github.com/joakin'>joakin</a></p>
    </div>
  </div>
)

const DownloadForm = ({ status, onSubmit }) => (
  <form className='DownloadForm' onSubmit={preventDefaultAnd((e) =>
                    onSubmit(parseSubmitForm(e.target)))}>
    <h5>Download your collections</h5>
    <div className='FormRow row'>
      <div className='eight columns'>
        <label htmlFor='username'>User</label>
        <input className='u-full-width' name='username' type='text' placeholder='User name'/>
      </div>
      <div className='four columns'>
        <label htmlFor='domain'>From site</label>
        <select className='u-full-width' name='domain'>
          <option value='en.wikipedia.org'>EN wiki</option>
          <option value='he.wikipedia.org'>HE wiki</option>
        </select>
      </div>
    </div>
    <div className='FormActions'>
      {status
        ? <p style={{color: 'yellowgreen'}}>{status}</p>
        : <input type='submit' value='Download'/>}
    </div>
  </form>
)

const preventDefaultAnd = (fn) => (e) => { e.preventDefault(); fn(e) }

const parseSubmitForm = (form) => {
  const domain = form.querySelector('[name=domain]')
  return {
    domain: domain.options[domain.selectedIndex].value,
    user: form.querySelector('[name=username]').value
  }
}

const fetchGatherCollections = ({ user, domain }, events) => {
  events.emit('status', `Fetching user ${user} lists from ${domain}`)
  fetchUserLists(user, domain)
    .then((lists) => {
      events.emit('status', `Received ${lists.length} lists for ${user}`)
      return lists.reduce((prev, list, i) =>
        prev.then((acc) => {
          events.emit('status', `List ${i + 1} of ${lists.length}. Fetching ${list.label}`)
          return fetchListPages(list, domain).then((pages) =>
            acc.concat({...list, pages}))
        }),
      Promise.resolve([]))
    })
    .then((lists) => events.emit('userlists-success', lists))
    .catch((e) => events.emit('userlists-error', e))
}

const fetchUserLists = (user, domain) =>
  fetch(`https://crossorigin.me/https://${domain}/w/api.php?action=query&list=lists&lstowner=${encodeURIComponent(user)}&format=json&lstprop=label%7Cdescription%7Cpublic%7Creview%7Cimage%7Ccount%7Cupdated%7Cowner&lstlimit=500`)
    .then((resp) => resp.json())
    .then((res) => res.query.lists)

const fetchListPages = ({ id }, domain) =>
  fetch(`https://crossorigin.me/https://${domain}/w/api.php?action=query&list=listpages&format=json&lspid=${id}&lsplimit=500`)
    .then((resp) => resp.json())
    .then((res) => res.query.listpages)

const downloadZip = (data) => {
  const zip = new Zip()
  zip.file('collections.json', JSON.stringify(data, null, 2))
  zip.file('collections.yaml', toYaml(data))
  const content = zip.generate({ type: 'blob' })
  saveAs(content, 'collections.zip')
}

render(state)
