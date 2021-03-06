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

let state = {
  options: null,
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
events.on('options', after((options) => ({
  ...state, options
}), render))

function render (newState) {
  state = newState
  reactRender(
    <App
      {...state}
      onSubmit={(options) => {
        events.emit('options', options)
        fetchGatherCollections(options, events)
      }}
      onDownload={(lists) => downloadZip(lists, state.options)}
      />
  , document.getElementById('root'))
}

const App = ({ lists, error, status, onSubmit, onDownload }) => (
  <div className='App container'>
    <h1>Gather exporter</h1>
    <div className='row'>
      <p>Export your gather collections from a Wikimedia wiki.</p>
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

const LIMIT = 500

const fetchUserLists = (user, domain, lists = [], cont = '') =>
  fetch(`https://crossorigin.me/https://${domain}/w/api.php?action=query&list=lists&lstowner=${encodeURIComponent(user)}&format=json&lstprop=label%7Cdescription%7Cpublic%7Creview%7Cimage%7Ccount%7Cupdated%7Cowner&lstlimit=${LIMIT}&lstcontinue=${cont}`)
    .then((resp) => resp.json())
    .then((res) => {
      const all = lists.concat(res.query.lists)
      return res.continue
        ? fetchUserLists(user, domain, all, res.continue.lstcontinue)
        : all
    })

const fetchListPages = ({ id }, domain, pages = [], cont = '') =>
  fetch(`https://crossorigin.me/https://${domain}/w/api.php?action=query&list=listpages&format=json&lspid=${id}&lsplimit=${LIMIT}` +
        // It is awesome how inconsistent the API is. Above, fine, here not.
        (cont ? `&lspcontinue=${cont}` : ''))
    .then((resp) => resp.json())
    .then((res) => {
      const all = pages.concat(res.query.listpages)
      return res.continue
        ? fetchListPages({ id }, domain, all, res.continue.lspcontinue)
        : all
    })

const downloadZip = (data, options) => {
  const zip = new Zip()
  zip.file('collections.json', JSON.stringify(data, null, 2))
  zip.file('collections.yaml', toYaml(data))
  zip.file('collections.html', toHtml(data, options))
  zip.file('collections.mediawiki', toWiki(data, options))
  const content = zip.generate({ type: 'blob' })
  saveAs(content, 'collections.zip')
}

const toHtml = (data, {domain, user}) => {
  const lists = data.map(({
    label, description, updated, count, pages,
    image, imageurl, imagewidth, imageheight
  }) => {
    let pgs = pages.map(({ title }) =>
      `<li><a href='https://${domain}/wiki/${encodeURIComponent(title)}'>${title}</a></li>`)
    return `
    <section>
    <h2>${label}</h2>
    <img src='https://${imageurl}' style='width: 25%;float: right;' />
    <p>${description}</p>
    <p>Last updated: ${new Date(updated).toDateString()}</p>
    <ul>
      ${pgs.join('')}
    </ul>`
  })

  return `
  <body>
  <h1>${user}'s lists on ${domain}</h1>
  ${lists.join('')}
  </body>
  `
}

const toWiki = (data, {domain, user}) => {
  const lists = data.map(({
    label, description, updated, count, pages,
    image, imageurl, imagewidth, imageheight
  }) => {
    let pgs = pages.map(({ title }) =>
      `* [https://${domain}/wiki/${encodeURIComponent(title)} ${title}]`)
    const img = image ? `[[File: ${image}|thumb]]` : ''
    return `
==${label}==
${img}
${description}

Last updated: ${new Date(updated).toDateString()}

${pgs.join('\n')}`
  })

  return `
=${user}'s lists on ${domain}=
${lists.join('\n\n')}`
}

render(state)
